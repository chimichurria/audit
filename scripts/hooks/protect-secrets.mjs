// PreToolUse: bloquea escribir .env, editar detectores de seguridad y escribir secretos en archivos. Perfiles: off | standard | strict.
import { checkWrite, contentOfToolInput, readStdinJson } from '../../lib/guard.mjs';

if ((process.env.UIAUDIT_HOOK_PROFILE ?? 'standard') === 'off') process.exit(0);
const payload = await readStdinJson();
if (!payload) process.exit(0);
const ti = payload.tool_input ?? {};
const res = checkWrite({ file: ti.file_path, content: contentOfToolInput(ti) }, { checks: ['env', 'security-detectors', 'secrets'] });
if (!res.allowed) { console.error(`[security-audit] ${res.reasons[0]}`); process.exit(2); }
