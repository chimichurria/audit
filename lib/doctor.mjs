// Diagnóstico del entorno y de la config del proyecto. Lo usan scripts/doctor*.mjs, el CLI y el MCP.
import fs from 'node:fs';
import path from 'node:path';
import { chromium, webkit } from 'playwright';
import { toolVersion } from '../scripts/security/run-security.mjs';
import { validateAllowedHosts } from './policy.mjs';

const GITIGNORE_REQUIRED = ['.auth/', '.security-audit/', '.ux-audit/', '.ui-audit/', '.audit/', '.env'];

function gitignoreChecks(projectDir, add) {
  const gi = fs.existsSync(path.join(projectDir, '.gitignore')) ? fs.readFileSync(path.join(projectDir, '.gitignore'), 'utf8') : '';
  const lines = gi.split('\n').map((l) => l.trim());
  for (const p of GITIGNORE_REQUIRED) {
    const present = lines.includes(p) || lines.includes(p.replace(/\/$/, '')) || lines.includes(`/${p}`);
    add(present ? 'ok' : 'fail', `.gitignore ${present ? 'incluye' : 'no incluye'} ${p}`);
  }
}

export function doctorUi(projectDir = '.') {
  const checks = [];
  const add = (level, msg) => checks.push({ level, msg });
  const major = Number(process.versions.node.split('.')[0]);
  add(major >= 20 ? 'ok' : 'fail', `node ${process.versions.node} (>= 20)`);
  for (const [name, bt] of [['chromium', chromium], ['webkit', webkit]]) {
    let exe = '';
    try { exe = bt.executablePath(); } catch { exe = ''; }
    add(exe && fs.existsSync(exe) ? 'ok' : 'fail', `navegador ${name}${exe && fs.existsSync(exe) ? '' : ' no instalado: npx playwright install chromium webkit'}`);
  }
  const cfg = path.join(projectDir, 'ui-audit.config.json');
  if (!fs.existsSync(cfg)) add('fail', 'Falta ui-audit.config.json (corré ui-audit init)');
  else {
    const c = JSON.parse(fs.readFileSync(cfg, 'utf8'));
    add(c.baseUrl ? 'ok' : 'warn', c.baseUrl ? `baseUrl ${c.baseUrl}` : 'ui-audit.config.json sin baseUrl: solo escaneo estático');
    add('ok', `rutas: ${(c.routes ?? ['/']).join(', ')}`);
  }
  gitignoreChecks(projectDir, add);
  return { checks, ok: !checks.some((c) => c.level === 'fail') };
}

export function doctorSecurity(projectDir = '.') {
  const checks = [];
  const add = (level, msg) => checks.push({ level, msg });
  for (const [tool, args, required] of [['gitleaks', ['version'], true], ['osv-scanner', ['--version'], true], ['semgrep', ['--version'], false], ['docker', ['--version'], false]]) {
    const v = toolVersion(tool, args);
    add(v ? 'ok' : required ? 'fail' : 'warn', v ? `${tool} (${v})` : `falta ${tool} (${required ? 'requerida' : 'opcional'})${tool === 'docker' ? '' : `: brew install ${tool}`}`);
  }
  const cfgPath = path.join(projectDir, 'ui-audit.security.json');
  if (!fs.existsSync(cfgPath)) add('fail', 'Falta ui-audit.security.json (corré ui-audit init)');
  else {
    const cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
    for (const e of validateAllowedHosts(cfg.allowedHosts ?? [])) add('fail', e);
    if (cfg.policy?.offlineOnly) add('warn', 'policy.offlineOnly: sin red, sin osv/semgrep/ZAP ni navegador contra URLs');
    add('ok', `config ${path.basename(cfgPath)}`);
  }
  gitignoreChecks(projectDir, add);
  return { checks, ok: !checks.some((c) => c.level === 'fail') };
}

export const formatChecks = (r) => r.checks.map((c) => `${c.level === 'ok' ? 'OK  ' : c.level === 'warn' ? 'WARN' : 'FAIL'} ${c.msg}`).join('\n');
