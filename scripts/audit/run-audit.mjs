#!/usr/bin/env node
// Auditoría de UI multi-dispositivo: escaneo estático + Playwright (overflow, objetivos táctiles, axe-core WCAG 2.2 AA,
// tipografía, CLS, imágenes rotas, errores JS/HTTP) por ruta x dispositivo.
// Uso: node run-audit.mjs [--tag before] [--config ui-audit.config.json] [--offline] [--baseline <dir>] [--no-fail]
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { AxeBuilder } from '@axe-core/playwright';
import { scanTree, DEFAULT_IGNORE } from './static-scan.mjs';
import { resolveDevice, browserPool, applyBypass, addClsObserver, slug } from '../../lib/browser.mjs';
import { readJson, countBySeverity, scoreOf, writeReport, findingsMarkdown, diffFindings, today, isMain } from '../../lib/common.mjs';
import { loadPolicy, enforce } from '../../lib/policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const thresholds = () => readJson(path.join(here, 'thresholds.json'));

async function auditPage(page, { isMobile, thr }) {
  return page.evaluate(({ isMobile, tapMin, tapIdeal, minFont }) => {
    const vw = window.innerWidth;
    const visible = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      return r.width > 1 && r.height > 1 && cs.visibility !== 'hidden' && cs.display !== 'none' && Number(cs.opacity) > 0;
    };
    const describe = (el) => {
      const id = el.id ? `#${el.id}` : '';
      const cls = typeof el.className === 'string' && el.className.trim() ? `.${el.className.trim().split(/\s+/).slice(0, 2).join('.')}` : '';
      const txt = (el.innerText || el.getAttribute('aria-label') || el.getAttribute('name') || '').trim().slice(0, 30);
      return `${el.tagName.toLowerCase()}${id}${cls}${txt ? ` "${txt}"` : ''}`;
    };
    const out = { overflow: false, overflowBy: 0, offenders: [], tiny: [], small: [], smallText: [], brokenImages: [] };
    const sw = document.documentElement.scrollWidth;
    if (sw > vw + 1) {
      out.overflow = true;
      out.overflowBy = sw - vw;
      for (const el of document.body.querySelectorAll('*')) {
        const r = el.getBoundingClientRect();
        if (r.right > vw + 1 && r.width > 0 && !el.closest('[data-ui-audit-ignore]')) {
          const parentOver = el.parentElement && el.parentElement.getBoundingClientRect().right > vw + 1 && el.parentElement !== document.body;
          if (!parentOver) out.offenders.push(`${describe(el)} (${Math.round(r.right - vw)}px de más)`);
          if (out.offenders.length >= 5) break;
        }
      }
    }
    if (isMobile) {
      for (const el of document.querySelectorAll('a[href], button, input:not([type=hidden]), select, textarea, [role=button], [role=link], [onclick]')) {
        if (!visible(el)) continue;
        const cs = getComputedStyle(el);
        if (el.tagName === 'A' && cs.display === 'inline' && el.closest('p, li')) continue; // enlaces en texto: excepción de WCAG 2.5.8
        const r = el.getBoundingClientRect();
        const m = Math.min(r.width, r.height);
        if (m < tapMin) out.tiny.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
        else if (m < tapIdeal) out.small.push(`${describe(el)} ${Math.round(r.width)}x${Math.round(r.height)}`);
      }
    }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const seen = new Set();
    while (walker.nextNode()) {
      const el = walker.currentNode.parentElement;
      if (!el || seen.has(el) || !walker.currentNode.textContent.trim()) continue;
      seen.add(el);
      if (!visible(el)) continue;
      const fs = parseFloat(getComputedStyle(el).fontSize);
      if (fs < minFont) out.smallText.push(`${describe(el)} ${fs}px`);
    }
    for (const img of document.images) if (img.complete && img.naturalWidth === 0 && visible(img)) out.brokenImages.push(img.currentSrc || img.src);
    return out;
  }, { isMobile, tapMin: thr.tapTargetMinPx, tapIdeal: thr.tapTargetIdealPx, minFont: thr.minFontPx });
}

export async function runUiAudit({ projectDir = '.', config = {}, tag = today(), outDir, offline = false, baseline, policy } = {}) {
  const thr = thresholds();
  const pol = policy ?? loadPolicy(projectDir, config.allowedHosts);
  const baseUrl = process.env.AUDIT_BASE_URL ?? config.baseUrl;
  const eff = enforce({ offline, baseUrl }, pol);
  const out = outDir ?? path.resolve(projectDir, process.env.UIAUDIT_OUT ?? '.ui-audit', tag);
  const findings = [];
  const tools = {};
  const add = (f) => findings.push({ source: 'ui', owasp: [], fix: '', evidence: '', ...f });

  // 1) estático
  const staticDirs = config.staticDirs ?? ['.'];
  let ignores = 0;
  for (const d of staticDirs) {
    const root = path.resolve(projectDir, d);
    if (!fs.existsSync(root)) continue;
    const r = scanTree(root, [...new Set([...DEFAULT_IGNORE, ...(config.ignoreDirs ?? [])])]);
    ignores += r.ignores;
    for (const f of r.findings) add({ source: 'static-scan', id: f.id, severity: f.severity, title: f.msg, where: `${path.posix.join(d, f.file)}:${f.line}`, fix: f.fix, evidence: f.evidence });
  }
  tools['static-scan'] = 'ok';
  tools.ignores = String(ignores);

  // 2) navegador
  const routes = config.routes ?? ['/'];
  const deviceNames = config.devices ?? thr.defaultDevices;
  const pages = [];
  if (!eff.network) tools.playwright = 'skipped: --offline';
  else if (!baseUrl) tools.playwright = 'skipped: sin baseUrl';
  else {
    const base = new URL(baseUrl);
    const pool = browserPool();
    const axeSeen = new Map();
    try {
      for (const dname of deviceNames) {
        const dev = resolveDevice(dname);
        let browser;
        try { browser = await pool.get(dev.browserType); } catch (e) { tools[`browser:${dev.browserType}`] = `error: ${String(e.message).split('\n')[0]}`; continue; }
        const ctx = await browser.newContext(dev.opts);
        await applyBypass(ctx, base.host);
        await addClsObserver(ctx);
        for (const route of routes) {
          const page = await ctx.newPage();
          const where = `${route} @ ${dname}`;
          const errors = []; const bad = [];
          page.on('pageerror', (e) => errors.push(String(e.message).slice(0, 160)));
          page.on('response', (r) => { const u = new URL(r.url()); if (r.status() >= 400 && u.host === base.host && !/favicon/.test(u.pathname)) bad.push(`${r.status()} ${u.pathname}`); });
          try {
            const res = await page.goto(new URL(route, base).href, { waitUntil: 'load', timeout: thr.requestTimeoutMs });
            await page.waitForTimeout(config.waitMs ?? 600);
            const status = res?.status() ?? 0;
            if (status >= 500) add({ id: 'page-server-error', severity: 'P0', title: `La página responde ${status}`, where, fix: 'Revisar el log del servidor.' });
            else if (status >= 400) add({ id: 'page-not-found', severity: 'P1', title: `La página responde ${status}`, where, fix: 'Corregir la ruta o el enlace que lleva a ella.' });
            const a = await auditPage(page, { isMobile: dev.isMobile, thr });
            if (a.overflow) add({ id: 'horizontal-overflow', severity: dev.isMobile ? 'P1' : 'P2', title: `Scroll horizontal: ${a.overflowBy}px más ancho que la pantalla`, where, fix: 'max-width: 100%, flex-wrap, min-width: 0 en hijos flex; revisar anchos fijos.', evidence: a.offenders.slice(0, 3).join(' | ') });
            if (a.tiny.length) add({ id: 'tap-target-tiny', severity: 'P1', title: `${a.tiny.length} objetivo(s) táctil(es) < ${thr.tapTargetMinPx}px`, where, fix: `Mínimo ${thr.tapTargetMinPx}px (WCAG 2.2 AA 2.5.8), ideal ${thr.tapTargetIdealPx}px.`, evidence: a.tiny.slice(0, 3).join(' | ') });
            if (a.small.length) add({ id: 'tap-target-small', severity: 'P2', title: `${a.small.length} objetivo(s) táctil(es) < ${thr.tapTargetIdealPx}px`, where, fix: `Llevar a ${thr.tapTargetIdealPx}px (padding o min-height).`, evidence: a.small.slice(0, 3).join(' | ') });
            if (a.smallText.length) add({ id: 'font-too-small', severity: 'P2', title: `${a.smallText.length} texto(s) < ${thr.minFontPx}px`, where, fix: 'Cuerpo de texto >= 16px en móvil; nunca < 12px.', evidence: a.smallText.slice(0, 3).join(' | ') });
            if (a.brokenImages.length) add({ id: 'img-broken', severity: 'P2', title: `${a.brokenImages.length} imagen(es) rota(s)`, where, evidence: a.brokenImages.slice(0, 2).join(' | ') });
            const cls = await page.evaluate(() => window.__cls ?? 0).catch(() => 0);
            if (cls > thr.maxCls) add({ id: 'layout-shift', severity: 'P2', title: `CLS ${cls.toFixed(2)} al cargar`, where, fix: 'Reservar espacio para imágenes, banners y fuentes.' });
            if (errors.length) add({ id: 'js-error', severity: 'P1', title: 'Error de JavaScript al cargar', where, evidence: errors[0] });
            if (bad.some((x) => /^5/.test(x))) add({ id: 'http-5xx', severity: 'P1', title: 'Recurso propio con 5xx', where, evidence: bad.find((x) => /^5/.test(x)) });
            else if (bad.length && status < 400) add({ id: 'http-4xx', severity: 'P3', title: `${bad.length} recurso(s) propio(s) con 4xx`, where, evidence: bad.slice(0, 3).join(' | ') });
            const axe = await new AxeBuilder({ page }).withTags(config.axeTags ?? ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa']).analyze();
            for (const v of axe.violations) {
              const k = `${v.id}|${route}`;
              if (axeSeen.has(k)) { axeSeen.get(k).devices.add(dname); continue; }
              const f = { source: 'axe', id: `axe-${v.id}`, severity: thr.axeImpactMap[v.impact] ?? 'P3', owasp: [], title: `${v.help} (${v.nodes.length} elemento/s)`, where: route, fix: v.helpUrl, evidence: v.nodes.slice(0, 2).map((n) => n.target.join(' ')).join(' | '), devices: new Set([dname]) };
              axeSeen.set(k, f);
            }
            const shot = path.join(out, `${slug(route)}@${slug(dname)}.png`);
            fs.mkdirSync(out, { recursive: true });
            await page.screenshot({ path: shot, fullPage: false }).catch(() => {});
            pages.push({ route, device: dname, status, overflow: a.overflow, cls: Number(cls.toFixed(3)), screenshot: path.relative(projectDir, shot) });
          } catch (e) {
            add({ id: 'page-load-failed', severity: 'P0', title: `No carga: ${String(e.message).split('\n')[0]}`, where });
          } finally { await page.close(); }
        }
        await ctx.close();
      }
      for (const f of axeSeen.values()) add({ ...f, evidence: `${f.evidence} [${[...f.devices].join(', ')}]`, devices: undefined });
      tools.playwright = 'ok';
      tools.axe = 'ok';
    } catch (e) {
      tools.playwright = `error: ${String(e.message).split('\n')[0]}`;
    } finally { await pool.closeAll(); }
  }

  for (const f of findings) delete f.devices;
  const counts = countBySeverity(findings);
  const score = scoreOf(counts, thr.weights);
  const ranBrowser = String(tools.playwright).startsWith('ok');
  const blocking = findings.filter((f) => thr.failOn.includes(f.severity)).length;
  const status = blocking > 0 ? 'fail' : !ranBrowser ? 'incomplete' : 'pass';
  const report = { dimension: 'ui', tag, baseUrl: baseUrl ?? null, generatedAt: new Date().toISOString(), status, score, counts, tools, policyNotes: eff.reasons, pages, findings };

  const md = [`# UI multi-dispositivo — ${tag}`, '', `**Estado: ${status.toUpperCase()}** · score ${score} · P0 ${counts.P0} · P1 ${counts.P1} · P2 ${counts.P2} · P3 ${counts.P3}`, ''];
  if (!ranBrowser) md.push(`> La medición en navegador no corrió (${tools.playwright}). El reporte **no puede aprobar** solo con el escaneo estático.`, '');
  if (eff.reasons.length) md.push(...eff.reasons.map((r) => `> ${r}`), '');
  md.push('## Herramientas', ...Object.entries(tools).map(([k, v]) => `- ${k}: ${v}`), '');
  if (pages.length) md.push('## Páginas', '| Ruta | Dispositivo | Status | Overflow | CLS |', '|---|---|---|---|---|', ...pages.map((p) => `| ${p.route} | ${p.device} | ${p.status} | ${p.overflow ? '**sí**' : 'no'} | ${p.cls} |`), '');
  md.push('## Hallazgos por severidad', '', ...findingsMarkdown(findings));
  if (baseline) {
    const prev = readJson(path.join(path.resolve(projectDir, baseline), 'report.json')).findings;
    const d = diffFindings(prev, findings, thr.failOn);
    report.diff = { resolved: d.resolved.length, added: d.added.length, addedBlocking: d.addedBlocking.length };
    md.splice(3, 0, `Contra baseline: resueltos ${d.resolved.length} · nuevos ${d.added.length} (${d.addedBlocking.length} P0/P1)`, '');
  }
  writeReport(out, report, md.join('\n'));
  report.outDir = out;
  return report;
}

if (isMain(import.meta.url)) {
  const argv = process.argv.slice(2);
  const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const cfgPath = opt('config', 'ui-audit.config.json');
  const config = readJson(cfgPath, {});
  const r = await runUiAudit({ projectDir: '.', config, tag: opt('tag', today()), offline: argv.includes('--offline'), baseline: opt('baseline') });
  console.log(`${r.status.toUpperCase()} · score ${r.score} · P0 ${r.counts.P0} P1 ${r.counts.P1} P2 ${r.counts.P2} P3 ${r.counts.P3} → ${path.join(r.outDir, 'report.md')}`);
  process.exit(r.status !== 'pass' && !argv.includes('--no-fail') ? 1 : 0);
}
