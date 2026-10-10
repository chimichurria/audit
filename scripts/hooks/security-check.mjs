// PostToolUse: avisa de patrones inseguros tras cada edición. strict bloquea ante P0/P1.
import fs from 'node:fs';
import { scanText } from '../security/security-scan.mjs';
import { readStdinJson } from '../../lib/guard.mjs';

const profile = process.env.UIAUDIT_HOOK_PROFILE ?? 'standard';
if (profile === 'off') process.exit(0);
const file = (await readStdinJson())?.tool_input?.file_path ?? '';
const f = file.replaceAll('\\', '/');
if (!/\.(?:css|scss|tsx|jsx|ts|js|mjs|cjs|html|sql|ya?ml|json)$/.test(f) || /\.(?:test|spec)\.|(?:^|\/)(?:tests?|fixtures)\//.test(f) || !fs.existsSync(file)) process.exit(0);

const hits = scanText(fs.readFileSync(file, 'utf8'), f).filter((h) => h.id !== 'env-file');
if (!hits.length) process.exit(0);
const msg = hits.map((h) => `- [${h.severity}] ${h.id} (línea ${h.line}, ${h.owasp.join('/')}): ${h.msg}`).join('\n');
if (profile === 'strict' && hits.some((h) => ['P0', 'P1'].includes(h.severity))) {
  console.error(`[security-audit] Corregí antes de seguir:\n${msg}`);
  process.exit(2);
}
console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext: `[security-audit] Posibles problemas de seguridad en ${file}:\n${msg}` } }));
