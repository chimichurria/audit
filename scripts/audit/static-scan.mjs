#!/usr/bin/env node
// Escaneo estático de UI/UX móvil (heurístico, sin dependencias). Misma forma que security-scan: scanText/scanTree.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const lineOf = (text, index) => text.slice(0, index).split('\n').length;
const isMarkup = (f) => /\.(?:html|jsx|tsx|vue|svelte|astro)$/.test(f);
const isStyle = (f) => /\.(?:css|scss|sass|less)$/.test(f);
const isCode = (f) => /\.(?:jsx|tsx|js|ts|vue|svelte|astro|html)$/.test(f);

export const RULES = [
  { id: 'viewport-zoom-disabled', severity: 'P1', when: (f) => isMarkup(f) || /layout\.(?:t|j)sx?$/.test(f), re: /user-scalable\s*=\s*(?:no|0)|maximum-scale\s*=\s*1(?:\.0)?\b|userScalable\s*:\s*false|maximumScale\s*:\s*1\b/g, msg: 'Zoom deshabilitado: impide ampliar en el celular (WCAG 1.4.4).', fix: 'Quitar user-scalable=no / maximum-scale=1.' },
  { id: 'input-font-small', severity: 'P2', when: isStyle, re: /(?:input|select|textarea)[^{}]*\{[^}]*font-size\s*:\s*(?:1[0-5]|[0-9])px/g, msg: 'Inputs con font-size < 16px: iOS hace zoom al enfocar.', fix: 'font-size: 16px (o 1rem) en inputs.' },
  { id: 'vh-100', severity: 'P2', when: (f) => isStyle(f) || isCode(f), re: /(?:min-|max-)?height\s*:\s*100vh|h-screen\b/g, msg: '100vh en móvil queda tapado por la barra del navegador.', fix: 'Usar 100dvh/100svh (o min-h-dvh en Tailwind).' },
  { id: 'fixed-width-large', severity: 'P2', when: (f) => isStyle(f) || isCode(f), re: /(?<![-\w])width\s*:\s*['"]?(?:[4-9]\d{2}|\d{4,})px|\bw-\[(?:[4-9]\d{2}|\d{4,})px\]/g, msg: 'Ancho fijo > 400px: provoca scroll horizontal en celular.', fix: 'max-width + width: 100% (o clases responsive).' },
  { id: 'outline-none', severity: 'P2', when: (f, t) => (isStyle(f) || isCode(f)) && !/focus-visible/.test(t), re: /outline\s*:\s*(?:none|0)\b|\boutline-none\b/g, msg: 'Foco invisible sin :focus-visible: inaccesible por teclado (WCAG 2.4.7).', fix: 'Agregar estilo :focus-visible (o focus-visible:ring).' },
  { id: 'img-no-alt', severity: 'P1', when: isMarkup, re: /<(?:img|Image)\b(?![^>]*\balt\s*=)[^>]*>/g, msg: 'Imagen sin alt (WCAG 1.1.1).', fix: 'alt descriptivo, o alt="" si es decorativa.' },
  { id: 'img-no-dimensions', severity: 'P3', when: isMarkup, re: /<img\b(?![^>]*\bwidth\s*=)[^>]*>/g, msg: 'Imagen sin width/height: genera saltos de layout (CLS).', fix: 'Declarar width y height (o aspect-ratio).' },
  { id: 'click-on-div', severity: 'P2', when: isMarkup, re: /<(?:div|span)\b(?![^>]*\brole\s*=)[^>]*\bonClick\s*=/g, msg: 'onClick en div/span sin role: no es operable por teclado ni lector de pantalla.', fix: 'Usar <button> (o role="button" + tabIndex + onKeyDown).' },
  { id: 'fixed-no-safe-area', severity: 'P3', when: (f, t) => isStyle(f) && /position\s*:\s*fixed/.test(t) && /bottom\s*:\s*0/.test(t) && !/safe-area-inset/.test(t), re: /position\s*:\s*fixed/g, msg: 'Elemento fijo abajo sin safe-area: el home indicator del iPhone lo tapa.', fix: 'padding-bottom: env(safe-area-inset-bottom).' }
];

export const FILE_RULES = [
  { id: 'viewport-missing', severity: 'P1', test: (f, t) => /\.html$/.test(f) && /<html\b/i.test(t) && !/name=["']viewport["']/i.test(t), msg: 'HTML sin meta viewport: en celular se ve como escritorio achicado.', fix: '<meta name="viewport" content="width=device-width, initial-scale=1">' }
];

export function scanText(text, file = '') {
  const f = file.replaceAll('\\', '/');
  const lines = text.split('\n');
  const ignored = (line, id) => /ui-audit-ignore:\s*([\w-]+)\s*[—-]\s*\S+/.exec(lines[line - 2] ?? '')?.[1] === id;
  const hits = [];
  for (const r of RULES) {
    if (r.when && !r.when(f, text)) continue;
    for (const m of text.matchAll(r.re)) {
      const line = lineOf(text, m.index);
      if (ignored(line, r.id)) continue;
      hits.push({ id: r.id, severity: r.severity, line, msg: r.msg, fix: r.fix, evidence: (lines[line - 1] ?? '').trim().slice(0, 120) });
    }
  }
  for (const r of FILE_RULES) if (r.test(f, text)) hits.push({ id: r.id, severity: r.severity, line: 1, msg: r.msg, fix: r.fix, evidence: '' });
  return hits.sort((a, b) => a.line - b.line);
}

const EXT = /\.(?:html|jsx|tsx|js|ts|vue|svelte|astro|css|scss|sass|less)$/;
export const DEFAULT_IGNORE = ['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '.vercel', '.ui-audit', '.security-audit', '.ux-audit', '.audit', 'out', '.codex', '.cursor', '.claude', '.agents', '.windsurf'];

export function scanTree(root, ignoreDirs = DEFAULT_IGNORE) {
  const findings = [];
  let ignores = 0;
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) { if (!ignoreDirs.includes(e.name)) walk(full); continue; }
      const rel = path.relative(root, full).replaceAll('\\', '/');
      if (!EXT.test(rel) || /\.min\.(?:js|css)$/.test(rel)) continue;
      if (fs.statSync(full).size > 1_000_000) continue;
      const text = fs.readFileSync(full, 'utf8');
      ignores += (text.match(/ui-audit-ignore:/g) ?? []).length;
      for (const h of scanText(text, rel)) findings.push({ source: 'static-scan', file: rel, ...h });
    }
  };
  walk(root);
  return { findings, ignores };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { findings, ignores } = scanTree(process.argv[2] ?? '.');
  for (const f of findings) console.log(`[${f.severity}] ${f.file}:${f.line} ${f.id} ${f.msg}${f.evidence ? ` -> ${f.evidence}` : ''}`);
  console.log(`\n${findings.length} hallazgos, ${ignores} ui-audit-ignore.`);
  process.exit(findings.some((f) => ['P0', 'P1'].includes(f.severity)) ? 1 : 0);
}
