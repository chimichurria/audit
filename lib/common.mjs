// Utilidades compartidas por las tres dimensiones (UI, seguridad, UX), el CLI y el servidor MCP.
import fs from 'node:fs';
import path from 'node:path';

export const SEVERITIES = ['P0', 'P1', 'P2', 'P3'];
export const today = () => new Date().toISOString().slice(0, 10);

export function readJson(file, fallback = undefined) {
  if (!fs.existsSync(file)) {
    if (fallback !== undefined) return fallback;
    throw new Error(`No existe ${file}`);
  }
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export function countBySeverity(findings) {
  const counts = { P0: 0, P1: 0, P2: 0, P3: 0 };
  for (const f of findings) counts[f.severity] = (counts[f.severity] ?? 0) + 1;
  return counts;
}

export const scoreOf = (counts, weights) => Math.max(0, 100 - Object.entries(counts).reduce((s, [k, n]) => s + n * (weights[k] ?? 0), 0));

export const findingKey = (f) => `${f.source}|${f.id}|${f.where}`;

export function diffFindings(prev, next, failOn = ['P0', 'P1']) {
  const a = new Set(prev.map(findingKey));
  const b = new Set(next.map(findingKey));
  const resolved = prev.filter((f) => !b.has(findingKey(f)));
  const added = next.filter((f) => !a.has(findingKey(f)));
  const persistent = next.filter((f) => a.has(findingKey(f)));
  return { resolved, added, persistent, addedBlocking: added.filter((f) => failOn.includes(f.severity)) };
}

// Escribe report.json/report.md en outDir y copia la corrida a <padre>/latest.
export function writeReport(outDir, report, md, name = 'report') {
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, `${name}.json`), JSON.stringify(report, null, 2));
  fs.writeFileSync(path.join(outDir, `${name}.md`), md);
  const latest = path.resolve(path.dirname(outDir), 'latest');
  if (path.resolve(outDir) !== latest) {
    fs.rmSync(latest, { recursive: true, force: true });
    fs.cpSync(outDir, latest, { recursive: true });
  }
}

export function findingsMarkdown(findings) {
  const md = [];
  for (const sev of SEVERITIES) {
    const list = findings.filter((f) => f.severity === sev);
    if (!list.length) continue;
    md.push(`### ${sev} (${list.length})`);
    for (const f of list) md.push(`- **${f.id}**${f.owasp?.length ? ` [${f.owasp.join(', ')}]` : ''} ${f.title} — \`${f.where}\`${f.evidence ? ` (${f.evidence})` : ''}${f.fix ? `\n  - Fix: ${f.fix}` : ''}`);
    md.push('');
  }
  return md;
}

// Resumen compacto para el MCP y la consola: estado, conteos y top N bloqueantes.
export function summarize(report, top = 10) {
  const findings = report.findings ?? [];
  return {
    dimension: report.dimension,
    tag: report.tag,
    status: report.status,
    score: report.score,
    counts: report.counts,
    top: findings.filter((f) => ['P0', 'P1'].includes(f.severity)).slice(0, top).map((f) => `[${f.severity}] ${f.id}: ${f.title} — ${f.where}`)
  };
}

export const isMain = (metaUrl) => {
  if (!process.argv[1]) return false;
  try { return fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(metaUrl).pathname); } catch { return false; }
};
