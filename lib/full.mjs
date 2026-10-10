// Auditoría completa: UI → Seguridad → Flujos por perfil, y reporte consolidado en .audit/<tag>/REPORT.md.
import fs from 'node:fs';
import path from 'node:path';
import { runUiAudit } from '../scripts/audit/run-audit.mjs';
import { runSecurity } from '../scripts/security/run-security.mjs';
import { runJourneys } from '../scripts/ux/run-journeys.mjs';
import { loadConfigs } from './project.mjs';
import { loadPolicy, enforce } from './policy.mjs';
import { summarize, today } from './common.mjs';

const DIM_LABEL = { ui: 'UI multi-dispositivo', security: 'Seguridad', ux: 'Flujos por perfil' };
const DIR = { ui: '.ui-audit', security: '.security-audit', ux: '.ux-audit' };
const SEV_RANK = { P0: 0, P1: 1, P2: 2, P3: 3 };

// Esfuerzo estimado por tipo de hallazgo (S/M/L) para ordenar el backlog. Es una heurística: el agente la ajusta.
export function effortOf(f) {
  if (/^secret-|gitleaks|sensitive-file-exposed/.test(f.id) || f.source === 'gitleaks') return 'L';
  if (/broken-access-control|journey-failed|api-route-no-auth|server-action-no-auth|webhook-no-signature|cors-credentials-open|legit-access-denied/.test(f.id)) return 'M';
  if (f.source === 'osv-scanner' || /csp-missing|horizontal-overflow|sql-concat|service-role-in-client/.test(f.id)) return 'M';
  return 'S';
}

// Lo que el agente nunca hace solo: queda como acción humana en el reporte.
export function humanActions(reports) {
  const all = reports.flatMap((r) => r.findings ?? []);
  const acts = new Set();
  if (all.some((f) => /^secret-/.test(f.id) || f.source === 'gitleaks' || f.id === 'secret-in-bundle')) acts.add('Rotar en el servicio de origen cada secreto detectado y purgar el historial git (git filter-repo / BFG). Quitarlo del código no lo des-filtra.');
  if (all.some((f) => f.id === 'sensitive-file-exposed')) acts.add('Bloquear el archivo expuesto en el despliegue y rotar todo lo que contenía.');
  if (all.some((f) => f.id === 'broken-access-control')) acts.add('Revisar y aplicar las migraciones de RLS que el agente haya dejado en supabase/migrations/ (no se aplican solas).');
  if (all.some((f) => /hsts|no-https-redirect/.test(f.id))) acts.add('Confirmar HTTPS forzado y HSTS en el dominio de producción (Vercel → Domains).');
  acts.add('Verificar Deployment Protection de Vercel en previews y reglas de rate limit/WAF en login, formularios y webhooks.');
  acts.add('2FA en GitHub, Vercel, Supabase, Meta Business, dominio y correo del proyecto.');
  acts.add('Probar en dispositivos reales (iPhone y Android) los flujos críticos: la emulación no reemplaza al dispositivo.');
  return [...acts];
}

function notVerified(r) {
  return Object.entries(r.tools ?? {})
    .filter(([k, v]) => /^(skipped|error)/.test(String(v)) && !(k === 'zap' && /no solicitado/.test(v)))
    .map(([k, v]) => `${k}: ${v}`);
}

export async function runFull({ projectDir, tag = today(), offline = false, zap = false, baseline, onProgress = () => {} } = {}) {
  const cfg = loadConfigs(projectDir);
  const policy = loadPolicy(projectDir, cfg.ui?.allowedHosts ?? cfg.journeys?.allowedHosts);
  const eff = enforce({ offline, zap, baseUrl: cfg.security?.baseUrl ?? cfg.ui?.baseUrl }, policy);
  const base = (dim) => (baseline ? path.join(DIR[dim], baseline) : undefined);
  const reports = [];

  onProgress('ui', 'Midiendo UI multi-dispositivo…');
  reports.push(await runUiAudit({ projectDir, config: cfg.ui ?? {}, tag, offline: eff.offline, baseline: base('ui'), policy }));
  onProgress('security', 'Midiendo seguridad…');
  reports.push(await runSecurity({ projectDir, config: cfg.security ?? {}, tag, offline: eff.offline, zap: eff.zap, baseline: base('security'), policy }));
  if (cfg.journeys) {
    onProgress('ux', 'Recorriendo flujos por perfil…');
    reports.push(await runJourneys({ projectDir, config: cfg.journeys, tag, offline: eff.offline, baseline: baseline ? path.join(DIR.ux, baseline) : undefined, policy }));
  } else {
    reports.push({ dimension: 'ux', tag, status: 'incomplete', score: null, counts: { P0: 0, P1: 0, P2: 0, P3: 0 }, tools: { journeys: 'skipped: falta ui-audit.journeys.json (corré ui-audit init)' }, findings: [] });
  }

  const status = reports.some((r) => r.status === 'fail') ? 'fail' : reports.some((r) => r.status !== 'pass') ? 'incomplete' : 'pass';
  const all = reports.flatMap((r) => (r.findings ?? []).map((f) => ({ ...f, dimension: r.dimension, effort: effortOf(f) })));
  const ordered = all.sort((a, b) => SEV_RANK[a.severity] - SEV_RANK[b.severity] || 'SML'.indexOf(a.effort) - 'SML'.indexOf(b.effort));
  const row = (f) => `| ${f.severity} | ${DIM_LABEL[f.dimension]} | ${f.id} | ${f.title.replaceAll('|', '/')} | \`${String(f.where).replaceAll('|', '/')}\` | ${f.effort} |`;
  const icon = { pass: '🟢', incomplete: '🟡', fail: '🔴' };

  const md = [
    `# Auditoría completa — ${path.basename(projectDir)} — ${tag}`, '',
    `**Estado general: ${status.toUpperCase()}**${eff.reasons.length ? `\n\n${eff.reasons.map((r) => `> ${r}`).join('\n')}` : ''}`, '',
    '## Resumen',
    '| Dimensión | Estado | Score | P0 | P1 | P2 | P3 | Qué no se verificó |', '|---|---|---|---|---|---|---|---|',
    ...reports.map((r) => `| ${DIM_LABEL[r.dimension]} | ${icon[r.status] ?? ''} ${r.status} | ${r.score ?? '—'} | ${r.counts.P0} | ${r.counts.P1} | ${r.counts.P2} | ${r.counts.P3} | ${notVerified(r).join('; ') || '—'} |`),
    '', '## P0 de cualquier dimensión (primero)',
    ...(ordered.filter((f) => f.severity === 'P0').length ? ['| Sev | Dimensión | Id | Qué | Dónde | Esfuerzo |', '|---|---|---|---|---|---|', ...ordered.filter((f) => f.severity === 'P0').map(row)] : ['Ninguno.']),
    '', '## Acciones humanas (el agente no las hace)', ...humanActions(reports).map((a) => `- [ ] ${a}`),
    '', '## Backlog priorizado (severidad × esfuerzo)', '| Sev | Dimensión | Id | Qué | Dónde | Esfuerzo |', '|---|---|---|---|---|---|', ...ordered.filter((f) => f.severity !== 'P0').map(row),
    '', '## Detalle por dimensión',
    ...reports.filter((r) => r.outDir).map((r) => `- ${DIM_LABEL[r.dimension]}: \`${path.relative(projectDir, path.join(r.outDir, r.dimension === 'ux' ? 'ux-report.md' : 'report.md'))}\``),
    '', '## Límites de esta corrida',
    '- Ninguna herramienta automática garantiza "100% seguro": no reemplaza un pentest, un modelo de amenazas ni la revisión de reglas de negocio (OWASP A06).',
    '- El análisis estático da falsos positivos y negativos; los hallazgos tipo api-route-no-auth son pistas para revisar, no veredictos.',
    '- headers-check es pasivo: no detecta XSS/inyección explotables ni fallas de autorización a nivel de datos.',
    '- Las mediciones en emulación no reemplazan dispositivos reales; las sugerencias UX son hipótesis informadas por mediciones.', ''
  ];
  const outDir = path.resolve(projectDir, '.audit', tag);
  fs.mkdirSync(outDir, { recursive: true });
  const consolidated = { tag, status, generatedAt: new Date().toISOString(), policyNotes: eff.reasons, fixAllowed: eff.fixAllowed, dimensions: reports.map((r) => summarize(r)), findings: ordered };
  fs.writeFileSync(path.join(outDir, 'REPORT.md'), md.join('\n'));
  fs.writeFileSync(path.join(outDir, 'report.json'), JSON.stringify(consolidated, null, 2));
  onProgress('done', 'Listo');
  return { ...consolidated, findings: undefined, reportPath: path.join(outDir, 'REPORT.md') };
}
