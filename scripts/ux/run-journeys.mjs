#!/usr/bin/env node
// Recorre flujos por perfil x dispositivo, mide fricción (hechos) y verifica control de acceso por perfil.
// Las SUGERENCIAS las redacta el agente ux-flow-analyst a partir de estos hechos.
// Uso: node run-journeys.mjs [--tag x] [--config ui-audit.journeys.json] [--baseline <dir>] [--no-fail]
import fs from 'node:fs';
import path from 'node:path';
import { resolveDevice, browserPool, applyBypass, addClsObserver, slug } from '../../lib/browser.mjs';
import { readJson, countBySeverity, scoreOf, writeReport, findingsMarkdown, diffFindings, today, isMain } from '../../lib/common.mjs';
import { loadPolicy, enforce } from '../../lib/policy.mjs';

const WEIGHTS = { P0: 25, P1: 10, P2: 3, P3: 1 };

export async function runJourneys({ projectDir = '.', config: cfg, tag = today(), outDir, offline = false, baseline, policy } = {}) {
  const pol = policy ?? loadPolicy(projectDir, cfg.allowedHosts);
  const baseUrl = process.env.AUDIT_BASE_URL ?? cfg.baseUrl;
  const out = outDir ?? path.resolve(projectDir, process.env.UXAUDIT_OUT ?? '.ux-audit', tag);
  fs.mkdirSync(out, { recursive: true });
  const eff = enforce({ offline, baseUrl }, pol);
  const findings = [];
  const add = (f) => findings.push({ owasp: [], fix: '', evidence: '', ...f });
  const facts = []; const accessResults = [];
  const tools = {};

  if (!eff.network || !baseUrl) {
    tools.playwright = !eff.network ? 'skipped: --offline' : 'skipped: sin baseUrl';
    return finish();
  }
  const base = new URL(baseUrl);
  const loginRe = new RegExp(cfg.loginPathRegex ?? 'login|signin|auth', 'i');
  const sub = (s) => s.replace(/\{\{(\w+)\}\}/g, (_, k) => { if (process.env[k] === undefined) throw new Error(`Falta la variable de entorno ${k}`); return process.env[k]; });
  const pool = browserPool();

  async function newContext(persona, deviceName) {
    const dev = resolveDevice(deviceName);
    const opts = { ...dev.opts };
    if (persona.auth?.storageState) {
      const ss = path.resolve(projectDir, persona.auth.storageState);
      if (!fs.existsSync(ss)) throw new Error(`Falta ${persona.auth.storageState}: corré "ui-audit auth ${persona.id}"`);
      opts.storageState = ss;
    }
    const ctx = await (await pool.get(dev.browserType)).newContext(opts);
    await addClsObserver(ctx);
    await applyBypass(ctx, base.host);
    return { ctx, isMobile: dev.isMobile };
  }

  async function runJourney(persona, deviceName, j) {
    const { ctx, isMobile } = await newContext(persona, deviceName);
    const page = await ctx.newPage();
    const tagId = `${j.id}@${deviceName}`;
    const errors = []; const bad = [];
    page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 160)); });
    page.on('response', (r) => { const u = new URL(r.url()); if (r.status() >= 400 && u.host === base.host && !/favicon/.test(u.pathname)) bad.push(`${r.status()} ${u.pathname}`); });
    const t0 = Date.now(); let interactions = 0; let scrolls = 0; let step = 0;
    const fact = { journey: j.id, persona: persona.id, device: deviceName, goal: j.goal, completed: false, interactions: 0, scrollsNeeded: 0, ms: 0, cls: 0, consoleErrors: [], badResponses: [], screenshot: '' };
    try {
      for (const s of j.steps) {
        step += 1;
        if (s.action === 'goto') { await page.goto(new URL(s.url, base).href, { waitUntil: 'load' }); continue; }
        if (s.action === 'wait') { await page.waitForTimeout(Math.min(Number(s.ms) || 500, 3000)); continue; }
        if (s.action === 'expectVisible') { await page.locator(s.selector).first().waitFor({ state: 'visible', timeout: 8000 }); continue; }
        if (s.action === 'expectUrl') { await page.waitForURL(new RegExp(s.pattern), { timeout: 8000 }); continue; }
        const loc = page.locator(s.selector).first();
        await loc.waitFor({ state: 'visible', timeout: 8000 });
        const vp = page.viewportSize(); const box = await loc.boundingBox();
        if (box && vp && (box.y < 0 || box.y + box.height > vp.height)) scrolls += 1;
        if (box && isMobile) {
          const m = Math.min(box.width, box.height);
          if (m < 24) add({ source: 'ux', id: 'tap-target-tiny', severity: 'P1', title: `Objetivo táctil de ${Math.round(m)}px en "${s.selector}"`, where: tagId, fix: 'Mínimo 24px (WCAG 2.2 AA), ideal 44px.' });
          else if (m < 44) add({ source: 'ux', id: 'tap-target-small', severity: 'P2', title: `Objetivo táctil de ${Math.round(m)}px en "${s.selector}"`, where: tagId, fix: 'Llevar a 44px.' });
        }
        interactions += 1;
        if (s.action === 'fill') {
          const info = await loc.evaluate((el) => ({ type: el.type, name: `${el.name} ${el.id} ${el.placeholder}`, inputMode: el.inputMode, ac: el.autocomplete, label: el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || (el.labels && el.labels[0] && el.labels[0].innerText) || '' }));
          if (!info.label) add({ source: 'ux', id: 'input-no-label', severity: 'P2', title: `Campo sin etiqueta accesible ("${s.selector}"): el placeholder no reemplaza al label`, where: tagId, fix: 'Agregar <label> o aria-label.' });
          if (/mail/i.test(info.name) && info.type !== 'email') add({ source: 'ux', id: 'input-keyboard-email', severity: 'P3', title: `Campo de email sin type=email (teclado equivocado en celular): ${s.selector}`, where: tagId, fix: 'type="email" + autocomplete="email".' });
          if (/tel|phone|whats|cel/i.test(info.name) && info.type !== 'tel' && info.inputMode !== 'tel') add({ source: 'ux', id: 'input-keyboard-tel', severity: 'P3', title: `Campo de teléfono sin type=tel/inputmode (teclado equivocado): ${s.selector}`, where: tagId, fix: 'type="tel" inputmode="tel" autocomplete="tel".' });
          await loc.fill(sub(String(s.value ?? '')));
        } else if (s.action === 'select') await loc.selectOption(sub(String(s.value ?? '')));
        else if (s.action === 'press') await loc.press(s.key ?? 'Enter');
        else if (s.action === 'click') {
          const before = s.submit ? await page.evaluate(() => ({ len: document.body.innerText.length, url: location.href })) : null;
          await loc.click();
          if (s.submit) {
            await page.waitForTimeout(900);
            const after = await page.evaluate(() => ({ len: document.body.innerText.length, url: location.href, live: !!document.querySelector('[role=alert],[role=status]') }));
            if (after.len === before.len && after.url === before.url && !after.live) add({ source: 'ux', id: 'no-feedback-after-submit', severity: 'P2', title: `Sin feedback visible tras enviar (${s.selector})`, where: tagId, fix: 'Confirmación o error visible y anunciado (role=status/alert) en < 1s.' });
          }
        } else throw new Error(`Acción desconocida: ${s.action}`);
      }
      fact.completed = true;
    } catch (e) {
      add({ source: 'ux', id: 'journey-failed', severity: 'P0', title: `El perfil "${persona.id}" no puede completar "${j.goal}" (paso ${step}: ${String(e.message).split('\n')[0]})`, where: tagId, fix: 'Reproducir con el screenshot; es un flujo roto para ese perfil.' });
      const shot = path.join(out, `fail-${slug(tagId)}.png`);
      await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
      fact.screenshot = path.relative(projectDir, shot);
    }
    fact.ms = Date.now() - t0; fact.interactions = interactions; fact.scrollsNeeded = scrolls;
    fact.cls = await page.evaluate(() => window.__cls ?? 0).catch(() => 0);
    fact.consoleErrors = [...new Set(errors)].slice(0, 10); fact.badResponses = [...new Set(bad)].slice(0, 10);
    if (fact.completed) {
      const shot = path.join(out, `end-${slug(tagId)}.png`);
      await page.screenshot({ path: shot }).catch(() => {});
      fact.screenshot = path.relative(projectDir, shot);
    }
    if (j.budget?.maxInteractions && interactions > j.budget.maxInteractions) add({ source: 'ux', id: 'journey-too-long', severity: 'P2', title: `${interactions} interacciones (presupuesto ${j.budget.maxInteractions}) para "${j.goal}"`, where: tagId, fix: 'Reducir pasos, precargar datos o dividir mejor.' });
    if (j.budget?.maxMs && fact.ms > j.budget.maxMs) add({ source: 'ux', id: 'journey-slow', severity: 'P2', title: `${fact.ms}ms (presupuesto ${j.budget.maxMs}ms) para "${j.goal}"`, where: tagId, fix: 'Revisar esperas, carga y animaciones del flujo.' });
    if (fact.cls > 0.1) add({ source: 'ux', id: 'layout-shift-in-flow', severity: 'P2', title: `CLS ${fact.cls.toFixed(2)} durante el flujo`, where: tagId, fix: 'Reservar espacio para imágenes/banners/fuentes.' });
    if (errors.some((x) => /^(Uncaught|TypeError|ReferenceError)/.test(x))) add({ source: 'ux', id: 'js-error-in-flow', severity: 'P1', title: `Error de JavaScript durante "${j.goal}"`, where: tagId, evidence: errors[0] });
    if (bad.some((x) => /^5\d\d/.test(x))) add({ source: 'ux', id: 'server-error-in-flow', severity: 'P1', title: `Respuesta 5xx durante "${j.goal}"`, where: tagId, evidence: bad.find((x) => /^5/.test(x)) });
    await ctx.close();
    return fact;
  }

  async function runAccess(persona, check) {
    const deviceName = persona.devices?.[0] ?? 'Desktop Chrome 1440';
    const { ctx } = await newContext(persona, deviceName);
    const url = new URL(check.route, base).href;
    let status = 0; let finalPath = ''; let body = '';
    try {
      if (check.type === 'api') {
        const r = await ctx.request.get(url, { maxRedirects: 0 });
        status = r.status(); finalPath = new URL(r.headers().location ?? url, base).pathname; body = (await r.text()).slice(0, 2000);
      } else {
        const page = await ctx.newPage();
        const r = await page.goto(url, { waitUntil: 'load' });
        await page.waitForTimeout(1500);
        status = r?.status() ?? 0; finalPath = new URL(page.url()).pathname; body = await page.evaluate(() => document.body.innerText).catch(() => '');
      }
    } finally { await ctx.close(); }
    const denied = [401, 403, 404].includes(status) || loginRe.test(finalPath) || (status >= 300 && status < 400);
    const leaked = (check.markers ?? []).filter((m) => body.includes(m));
    const where = `${persona.id} → ${check.route}`;
    let ok = true;
    if (check.expect === 'denied' && (!denied || leaked.length)) {
      ok = false;
      add({ source: 'access-matrix', id: 'broken-access-control', severity: 'P0', owasp: ['A01:2025'], title: `El perfil "${persona.id}" accede a ${check.route} (status ${status}${leaked.length ? `, se ve: ${leaked.join(' | ')}` : ''})`, where, fix: 'Control de acceso en el servidor (middleware NO alcanza solo): verificar rol en la ruta, en la API y en RLS.' });
    }
    if (check.expect === 'allowed' && denied) {
      ok = false;
      add({ source: 'access-matrix', id: 'legit-access-denied', severity: 'P1', title: `El perfil "${persona.id}" NO puede entrar a ${check.route} (status ${status})`, where, fix: 'Revisar rol/permiso: bloquea a un usuario legítimo.' });
    }
    return { persona: persona.id, route: check.route, expect: check.expect, status, finalPath, ok };
  }

  try {
    for (const persona of cfg.personas ?? []) {
      for (const j of (cfg.journeys ?? []).filter((x) => x.persona === persona.id)) {
        for (const d of persona.devices ?? ['iPhone 13']) {
          try { facts.push(await runJourney(persona, d, j)); }
          catch (e) { add({ source: 'ux', id: 'journey-setup-error', severity: 'P1', title: String(e.message).split('\n')[0], where: `${j.id}@${d}` }); }
        }
      }
    }
    const byId = Object.fromEntries((cfg.personas ?? []).map((p) => [p.id, p]));
    for (const c of cfg.accessChecks ?? []) {
      if (!byId[c.persona]) { add({ source: 'access-matrix', id: 'access-check-error', severity: 'P1', title: `Perfil desconocido: ${c.persona}`, where: `${c.persona} → ${c.route}` }); continue; }
      try { accessResults.push(await runAccess(byId[c.persona], c)); }
      catch (e) { add({ source: 'access-matrix', id: 'access-check-error', severity: 'P1', title: String(e.message).split('\n')[0], where: `${c.persona} → ${c.route}` }); }
    }
    tools.playwright = 'ok';
  } catch (e) {
    tools.playwright = `error: ${String(e.message).split('\n')[0]}`;
  } finally { await pool.closeAll(); }
  return finish();

  function finish() {
    const counts = countBySeverity(findings);
    const ran = String(tools.playwright).startsWith('ok');
    const status = counts.P0 || counts.P1 ? 'fail' : !ran ? 'incomplete' : 'pass';
    const report = { dimension: 'ux', tag, baseUrl: baseUrl ?? null, generatedAt: new Date().toISOString(), status, score: scoreOf(counts, WEIGHTS), counts, tools, policyNotes: eff.reasons, facts, accessResults, findings };
    const md = [`# Flujos por perfil — ${tag}`, '', `**Estado: ${status.toUpperCase()}** · P0 ${counts.P0} · P1 ${counts.P1} · P2 ${counts.P2} · P3 ${counts.P3}`, ''];
    if (!ran) md.push(`> Los flujos no corrieron (${tools.playwright}). El reporte **no puede aprobar**.`, '');
    md.push('## Flujos', '| Perfil | Flujo | Dispositivo | Completo | Interacciones | Scrolls | ms | CLS |', '|---|---|---|---|---|---|---|---|',
      ...facts.map((f) => `| ${f.persona} | ${f.journey} | ${f.device} | ${f.completed ? 'sí' : '**NO**'} | ${f.interactions} | ${f.scrollsNeeded} | ${f.ms} | ${f.cls.toFixed(2)} |`),
      '', '## Matriz de acceso', '| Perfil | Ruta | Esperado | Status | Resultado |', '|---|---|---|---|---|',
      ...accessResults.map((a) => `| ${a.persona} | ${a.route} | ${a.expect} | ${a.status} | ${a.ok ? 'OK' : '**FALLA**'} |`),
      '', '## Hallazgos', '', ...findingsMarkdown(findings));
    if (baseline) {
      const prev = readJson(path.join(path.resolve(projectDir, baseline), 'ux-report.json')).findings;
      const d = diffFindings(prev, findings);
      report.diff = { resolved: d.resolved.length, added: d.added.length, addedBlocking: d.addedBlocking.length };
      md.splice(3, 0, `Contra baseline: resueltos ${d.resolved.length} · nuevos ${d.added.length} (${d.addedBlocking.length} P0/P1)`, '');
    }
    writeReport(out, report, md.join('\n'), 'ux-report');
    report.outDir = out;
    return report;
  }
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const config = readJson(opt('config', 'ui-audit.journeys.json'));
  const r = await runJourneys({ projectDir: '.', config, tag: opt('tag', today()), offline: argv.includes('--offline'), baseline: opt('baseline') });
  console.log(`${r.status.toUpperCase()} · P0 ${r.counts.P0} P1 ${r.counts.P1} P2 ${r.counts.P2} P3 ${r.counts.P3} → ${path.join(r.outDir, 'ux-report.md')}`);
  process.exit(r.status !== 'pass' && !argv.includes('--no-fail') ? 1 : 0);
}
