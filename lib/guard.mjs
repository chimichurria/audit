// Guardas compartidas: las usan los hooks de Claude Code, el pre-commit de git (cualquier cliente) y el servidor MCP.
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { findSecrets } from '../scripts/security/security-scan.mjs';

export const SECURITY_DETECTORS = /(^|\/)(scripts\/security|scripts\/ux|tools\/security-audit|tools\/ux-audit)\/(security-thresholds\.json|security-scan\.mjs|headers-check\.mjs|run-security\.mjs|run-journeys\.mjs)$/;
export const UI_DETECTORS = /(^|\/)(scripts\/audit|tools\/ui-audit)\/(thresholds\.json|static-scan\.mjs|run-audit\.mjs|diff-report\.mjs)$/;
const TEST_PATH = /\.(?:test|spec)\.|(?:^|\/)(?:tests?|fixtures)\//;

export const isEnvFile = (file) => {
  const base = path.posix.basename(file.replaceAll('\\', '/'));
  return /^\.env(\..+)?$/.test(base) && !/\.(example|sample|template)$/.test(base);
};

// Devuelve { allowed, reasons[] }. checks: subconjunto de ['env', 'security-detectors', 'ui-detectors', 'secrets'].
export function checkWrite({ file = '', content = '' }, { env = process.env, checks = ['env', 'security-detectors', 'ui-detectors', 'secrets'] } = {}) {
  const f = String(file).replaceAll('\\', '/');
  const reasons = [];
  if (checks.includes('env') && isEnvFile(f)) {
    reasons.push('Bloqueado: el agente no escribe archivos .env. Dejá las variables en .env.example (sin valores) y cargalas vos en Vercel/Supabase.');
  }
  if (checks.includes('security-detectors') && SECURITY_DETECTORS.test(f) && env.SECAUDIT_ALLOW_DETECTOR_EDIT !== '1') {
    reasons.push('Bloqueado: no se editan detectores ni umbrales de seguridad para pasar una auditoría. Arreglá el código de la app. (Mantenimiento del kit: SECAUDIT_ALLOW_DETECTOR_EDIT=1)');
  }
  if (checks.includes('ui-detectors') && UI_DETECTORS.test(f) && env.UIAUDIT_ALLOW_DETECTOR_EDIT !== '1') {
    reasons.push('Bloqueado: no se editan detectores ni umbrales de UI para pasar una auditoría. Arreglá el código de la app. (Mantenimiento del kit: UIAUDIT_ALLOW_DETECTOR_EDIT=1)');
  }
  if (checks.includes('secrets') && content && !TEST_PATH.test(f)) {
    const found = findSecrets(content);
    if (found.length) reasons.push(`Bloqueado: el contenido incluye ${found.length} posible(s) secreto(s) (${[...new Set(found.map((s) => s.label))].join(', ')}). Usá variables de entorno.`);
  }
  return { allowed: reasons.length === 0, reasons };
}

// Contenido nuevo de un tool_input de Edit/Write/MultiEdit.
export const contentOfToolInput = (ti = {}) => [ti.content, ti.new_string, ...(Array.isArray(ti.edits) ? ti.edits.map((e) => e?.new_string) : [])].filter((s) => typeof s === 'string').join('\n');

// Revisa lo que está en el índice de git (pre-commit). Devuelve [{ file, reasons }].
export function checkStaged(cwd = '.', opts = {}) {
  const r = spawnSync('git', ['diff', '--cached', '--name-only', '--diff-filter=ACMR', '-z'], { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`git diff --cached falló: ${r.stderr}`);
  const out = [];
  for (const file of r.stdout.split('\0').filter(Boolean)) {
    const show = spawnSync('git', ['show', `:${file}`], { cwd, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 });
    const content = show.status === 0 && !show.stdout.includes('\0') ? show.stdout : '';
    const res = checkWrite({ file, content }, opts);
    if (!res.allowed) out.push({ file, reasons: res.reasons });
  }
  return out;
}

export async function readStdinJson() {
  let raw = '';
  for await (const c of process.stdin) raw += c;
  try { return JSON.parse(raw); } catch { return null; }
}
