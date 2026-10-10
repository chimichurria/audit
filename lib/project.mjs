// Carga y valida el proyecto auditado: las tres configs y la política.
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const CONFIG_FILES = { ui: 'ui-audit.config.json', security: 'ui-audit.security.json', journeys: 'ui-audit.journeys.json' };

export function resolveProjectDir(dir) {
  if (!dir) throw new Error('Falta projectDir (ruta absoluta del proyecto a auditar).');
  const abs = path.resolve(dir);
  if (!fs.existsSync(abs) || !fs.statSync(abs).isDirectory()) throw new Error(`No existe el directorio ${abs}`);
  return fs.realpathSync(abs);
}

export function gitRoot(dir) {
  const r = spawnSync('git', ['rev-parse', '--show-toplevel'], { cwd: dir, encoding: 'utf8' });
  return r.status === 0 ? r.stdout.trim() : null;
}

export function loadConfigs(projectDir) {
  const read = (f) => { const p = path.join(projectDir, f); return fs.existsSync(p) ? JSON.parse(fs.readFileSync(p, 'utf8')) : null; };
  return { ui: read(CONFIG_FILES.ui), security: read(CONFIG_FILES.security), journeys: read(CONFIG_FILES.journeys) };
}
