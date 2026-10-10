// PreToolUse (Parte 1): bloquea editar detectores y umbrales de UI para "pasar" una auditoría. Perfiles: off | standard | strict.
import { checkWrite, readStdinJson } from '../../lib/guard.mjs';

if ((process.env.UIAUDIT_HOOK_PROFILE ?? 'standard') === 'off') process.exit(0);
const payload = await readStdinJson();
const ti = payload?.tool_input ?? {};
const res = checkWrite({ file: ti.file_path }, { checks: ['ui-detectors'] });
if (!res.allowed) { console.error(`[ui-audit] ${res.reasons.join('\n')}`); process.exit(2); }
