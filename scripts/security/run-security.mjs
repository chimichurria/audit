#!/usr/bin/env node
// Orquesta: scan estático propio + gitleaks + osv-scanner + semgrep + headers/bundles + ZAP baseline (opcional).
// Uso: node run-security.mjs --tag before [--offline] [--zap] [--no-fail] [--config ui-audit.security.json] [--baseline <dir>]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { scanTree } from './security-scan.mjs';
import { checkHeaders } from './headers-check.mjs';
import { readJson, countBySeverity, scoreOf, writeReport, findingsMarkdown, diffFindings, today, isMain } from '../../lib/common.mjs';
import { loadPolicy, enforce } from '../../lib/policy.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
export const thresholds = () => readJson(path.join(here, 'security-thresholds.json'));

const run = (cmd, args, o = {}) => spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...o });
export function toolVersion(cmd, args = ['--version']) {
  const r = run(cmd, args);
  if (r.error || r.status !== 0) return null;
  return (r.stdout || r.stderr).trim().split('\n')[0].slice(0, 60);
}

// OSV: severidad del aviso (GHSA) o, si falta, el máximo CVSS del grupo.
function osvSeverity(v, groups, thr) {
  const named = String(v.database_specific?.severity ?? '').toUpperCase();
  if (thr.osvSeverityMap[named]) return thr.osvSeverityMap[named];
  const g = (groups ?? []).find((x) => (x.ids ?? []).includes(v.id) || (x.aliases ?? []).includes(v.id));
  const score = Number(g?.max_severity);
  if (Number.isFinite(score) && score > 0) return score >= 9 ? 'P1' : score >= 7 ? 'P2' : 'P3';
  return 'P3';
}

export async function runSecurity({ projectDir = '.', config = {}, tag = today(), outDir, offline = false, zap = false, baseline, policy } = {}) {
  const thr = thresholds();
  const pol = policy ?? loadPolicy(projectDir, config.allowedHosts);
  const baseUrl = process.env.AUDIT_BASE_URL ?? config.baseUrl;
  const eff = enforce({ offline, zap, baseUrl }, pol);
  const root = path.resolve(projectDir, config.scanDir ?? '.');
  const out = outDir ?? path.resolve(projectDir, process.env.SECAUDIT_OUT ?? '.security-audit', tag);
  fs.mkdirSync(out, { recursive: true });

  const findings = [];
  const tools = {};
  const norm = (f) => findings.push({ owasp: [], where: '', fix: '', evidence: '', ...f });

  // 1) scan estático propio
  const { findings: fs1, ignores } = scanTree(root, config.ignoreDirs);
  for (const f of fs1) norm({ source: 'security-scan', id: f.id, severity: f.severity, owasp: f.owasp, title: f.msg, where: `${f.file}:${f.line}`, evidence: f.evidence });
  tools['security-scan'] = 'ok';
  tools.ignores = String(ignores);

  // 2) gitleaks (historial git si hay .git; si no, directorio). No usa red.
  const glv = toolVersion('gitleaks', ['version']);
  if (glv) {
    const report = path.join(out, 'gitleaks.json');
    const mode = fs.existsSync(path.join(root, '.git')) ? 'git' : 'dir';
    const r = run('gitleaks', [mode, root, '--report-format', 'json', '--report-path', report, '--redact', '--no-banner', '--exit-code', '0']);
    if (r.status === 0 || fs.existsSync(report)) {
      const leaks = fs.existsSync(report) ? JSON.parse(fs.readFileSync(report, 'utf8') || '[]') : [];
      for (const l of leaks) norm({ source: 'gitleaks', id: l.RuleID, severity: 'P0', owasp: ['A02:2025', 'A04:2025'], title: `Secreto detectado: ${l.Description}`, where: `${l.File}:${l.StartLine}${l.Commit ? ` (commit ${String(l.Commit).slice(0, 7)})` : ''}`, fix: 'Rotar la credencial y purgar el historial (git filter-repo / BFG). Quitarla del código no alcanza.' });
      tools.gitleaks = `ok (${mode}, ${glv})`;
    } else tools.gitleaks = `error: ${(r.stderr || '').slice(0, 120)}`;
  } else tools.gitleaks = 'skipped: no instalado';

  // 3) osv-scanner (envía la lista de paquetes a OSV: se omite sin red)
  const osvv = toolVersion('osv-scanner');
  if (!eff.network) tools['osv-scanner'] = 'skipped: --offline';
  else if (osvv) {
    const r = run('osv-scanner', ['scan', 'source', '-r', root, '--format', 'json']);
    try {
      const data = JSON.parse(r.stdout || '{}');
      const seen = new Set();
      for (const res of data.results ?? []) for (const p of res.packages ?? []) for (const v of p.vulnerabilities ?? []) {
        const key = `${p.package?.name}@${p.package?.version}|${v.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        norm({ source: 'osv-scanner', id: v.id, severity: osvSeverity(v, p.groups, thr), owasp: ['A03:2025'], title: `${p.package?.name}@${p.package?.version}: ${v.summary ?? v.id}`, where: path.relative(root, res.source?.path ?? '') || 'lockfile', fix: 'Actualizar a una versión corregida (patch/minor), correr los tests y confirmar si el código vulnerable es alcanzable.' });
      }
      tools['osv-scanner'] = `ok (${osvv})`;
    } catch { tools['osv-scanner'] = `error: salida no interpretable (status ${r.status})`; }
  } else tools['osv-scanner'] = 'skipped: no instalado';

  // 4) semgrep (los rulesets del registro bajan reglas de la red: se omite sin red)
  const sgv = toolVersion('semgrep');
  if (!eff.network) tools.semgrep = 'skipped: --offline';
  else if (sgv) {
    const args = ['scan', ...(config.semgrepConfigs ?? ['p/owasp-top-ten']).flatMap((c) => ['--config', c]), '--metrics=off', '--json', '--quiet', root];
    const r = run('semgrep', args);
    try {
      for (const x of JSON.parse(r.stdout || '{}').results ?? []) norm({ source: 'semgrep', id: x.check_id, severity: thr.semgrepSeverityMap[x.extra?.severity] ?? 'P3', owasp: [].concat(x.extra?.metadata?.owasp ?? []), title: x.extra?.message ?? x.check_id, where: `${path.relative(root, x.path)}:${x.start?.line}` });
      tools.semgrep = `ok (${sgv})`;
    } catch { tools.semgrep = `error: salida no interpretable (status ${r.status})`; }
  } else tools.semgrep = 'skipped: no instalado';

  // 5) sitio desplegado (solo hosts permitidos; enforce ya lo validó)
  if (!eff.network || !baseUrl) tools['headers-check'] = !eff.network ? 'skipped: --offline' : 'skipped: sin baseUrl';
  else {
    try {
      const { findings: hf, thirdPartyHosts } = await checkHeaders({ ...config, baseUrl, allowedHosts: pol.allowedHosts, timeoutMs: thr.requestTimeoutMs, maxScripts: thr.maxBundleScripts });
      for (const f of hf) norm(f);
      tools['headers-check'] = 'ok';
      tools.thirdPartyHosts = thirdPartyHosts.join(', ') || 'ninguno';
    } catch (e) { tools['headers-check'] = `error: ${e.message}`; }
  }

  // 6) ZAP baseline (pasivo; opcional; requiere zap=true, Docker y host no productivo)
  if (!eff.zap) tools.zap = zap ? 'skipped: deshabilitado por política' : 'skipped: no solicitado';
  else if (!baseUrl) tools.zap = 'skipped: sin baseUrl';
  else if (toolVersion('docker')) {
    const r = run('docker', ['run', '--rm', '-v', `${out}:/zap/wrk/:rw`, '-t', 'ghcr.io/zaproxy/zaproxy:stable', 'zap-baseline.py', '-t', baseUrl, '-J', 'zap.json', '-m', String(config.zap?.minutes ?? 1)]);
    const jf = path.join(out, 'zap.json');
    if (fs.existsSync(jf)) {
      const zapr = JSON.parse(fs.readFileSync(jf, 'utf8'));
      const map = { 3: 'P1', 2: 'P2', 1: 'P3', 0: 'P3' };
      for (const s of zapr.site ?? []) for (const a of s.alerts ?? []) norm({ source: 'zap', id: String(a.pluginid), severity: map[Number(a.riskcode)] ?? 'P3', owasp: [], title: a.alert, where: a.instances?.[0]?.uri ?? s['@name'] ?? '' });
      tools.zap = `ok (exit ${r.status})`;
    } else tools.zap = `error: sin zap.json (exit ${r.status}); revisá permisos del volumen`;
  } else tools.zap = 'skipped: docker no disponible';

  // resumen
  const counts = countBySeverity(findings);
  const score = scoreOf(counts, thr.weights);
  const required = (config.requiredTools ?? ['gitleaks', 'osv-scanner']).filter((t) => !(t === 'osv-scanner' && !eff.network && pol.offlineOnly));
  const missing = required.filter((t) => !String(tools[t] ?? '').startsWith('ok'));
  const blocking = findings.filter((f) => thr.failOn.includes(f.severity)).length;
  const status = blocking > 0 ? 'fail' : missing.length ? 'incomplete' : 'pass';

  const report = { dimension: 'security', tag, root, baseUrl: baseUrl ?? null, generatedAt: new Date().toISOString(), status, score, counts, tools, missingRequired: missing, policyNotes: eff.reasons, findings };
  const md = [`# Seguridad — ${tag}`, '', `**Estado: ${status.toUpperCase()}** · score ${score} · P0 ${counts.P0} · P1 ${counts.P1} · P2 ${counts.P2} · P3 ${counts.P3}`, ''];
  if (missing.length) md.push(`> Herramientas requeridas que no corrieron: ${missing.join(', ')}. El reporte **no puede aprobar** sin ellas.`, '');
  if (eff.reasons.length) md.push(...eff.reasons.map((r) => `> ${r}`), '');
  md.push('## Herramientas', ...Object.entries(tools).map(([k, v]) => `- ${k}: ${v}`), '', '## Hallazgos por severidad', '', ...findingsMarkdown(findings));
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
  const flag = (n) => argv.includes(`--${n}`);
  const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
  const config = readJson(opt('config', 'ui-audit.security.json'), {});
  const r = await runSecurity({ projectDir: '.', config, tag: opt('tag', today()), offline: flag('offline'), zap: flag('zap'), baseline: opt('baseline') });
  if (r.diff) console.log(`Resueltos: ${r.diff.resolved} · Nuevos: ${r.diff.added} (${r.diff.addedBlocking} P0/P1)`);
  console.log(`${r.status.toUpperCase()} · score ${r.score} · P0 ${r.counts.P0} P1 ${r.counts.P1} P2 ${r.counts.P2} P3 ${r.counts.P3} → ${path.join(r.outDir, 'report.md')}`);
  process.exit(r.status !== 'pass' && !flag('no-fail') ? 1 : 0);
}
