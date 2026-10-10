#!/usr/bin/env node
// Compara dos corridas (cualquier dimensión): resueltos, nuevos y persistentes.
// Uso: node diff-report.mjs <dir-antes> <dir-despues> [--name report|ux-report]
import path from 'node:path';
import { readJson, diffFindings, isMain } from '../../lib/common.mjs';

export function diffReports(beforeDir, afterDir, name = 'report') {
  const a = readJson(path.join(beforeDir, `${name}.json`));
  const b = readJson(path.join(afterDir, `${name}.json`));
  const d = diffFindings(a.findings, b.findings);
  const fmt = (f) => `- [${f.severity}] ${f.id} — ${f.where}`;
  const md = [`# Diff ${a.tag} → ${b.tag}`, '', `Resueltos ${d.resolved.length} · Nuevos ${d.added.length} (${d.addedBlocking.length} P0/P1) · Persistentes ${d.persistent.length}`, '',
    '## Nuevos', ...d.added.map(fmt), '', '## Resueltos', ...d.resolved.map(fmt), ''].join('\n');
  return { ...d, md, regression: d.addedBlocking.length > 0 };
}

if (isMain(import.meta.url)) {
  const [before, after] = process.argv.slice(2).filter((x) => !x.startsWith('--'));
  const i = process.argv.indexOf('--name');
  const r = diffReports(before, after, i > 0 ? process.argv[i + 1] : 'report');
  console.log(r.md);
  process.exit(r.regression ? 1 : 0);
}
