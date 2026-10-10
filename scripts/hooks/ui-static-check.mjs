// PostToolUse (Parte 1): avisa de problemas de UI móvil tras cada edición. strict bloquea ante P0/P1.
import fs from 'node:fs';
import { scanText } from '../audit/static-scan.mjs';
import { readStdinJson } from '../../lib/guard.mjs';

const profile = process.env.UIAUDIT_HOOK_PROFILE ?? 'standard';
if (profile === 'off') process.exit(0);
const file = (await readStdinJson())?.tool_input?.file_path ?? '';
const f = file.replaceAll('\\', '/');
if (!/\.(?:css|scss|sass|less|tsx|jsx|ts|js|html|vue|svelte|astro)$/.test(f) || /\.(?:test|spec)\.|(?:^|\/)(?:tests?|fixtures)\//.test(f) || !fs.existsSync(file)) process.exit(0);

const hits = scanText(fs.readFileSync(file, 'utf8'), f);
if (!hits.length) process.exit(0);
const msg = hits.map((h) => `- [${h.severity}] ${h.id} (línea ${h.line}): ${h.msg} Fix: ${h.fix}`).join('\n');
if (profile === 'strict' && hits.some((h) => ['P0', 'P1'].includes(h.severity))) {
  console.error(`[ui-audit] Corregí antes de seguir:\n${msg}`);
  process.exit(2);
}
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `[ui-audit] Posibles problemas de UI móvil en ${file}:\n${msg}` } }));
