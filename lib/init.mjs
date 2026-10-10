// Prepara un proyecto: detecta el stack, propone las 3 configs (rutas y protegidas leídas del código),
// completa .gitignore e instala el guard pre-commit. dryRun por defecto: muestra el plan sin escribir.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { CONFIG_FILES } from './project.mjs';

const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const GITIGNORE_LINES = ['.auth/', '.ui-audit/', '.security-audit/', '.ux-audit/', '.audit/', '.env', '.env.*', '!.env.example'];
const PROTECTED_WORDS = /admin|dashboard|panel|backoffice|cuenta|account|perfil|profile|settings|ajustes|mis-|my-|private|privado|gestion|staff|rrpp|organizador|puerta/i;
// Rutas de autenticación: son públicas a propósito (login, callbacks, confirmaciones), nunca se esperan "denied".
const AUTH_WORDS = /login|signin|sign-in|signout|sign-out|signup|callback|confirm|auth|ingresar|registro|olvid|reset/i;
const HOOK_MARK = '# ui-audit guard (pre-commit)';

function walk(dir, out = [], depth = 0) {
  if (!fs.existsSync(dir) || depth > 8) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.git', 'dist', 'build'].includes(e.name)) continue;
    const full = path.join(dir, e.name);
    if (e.isDirectory()) walk(full, out, depth + 1); else out.push(full);
  }
  return out;
}

// Rutas de Next.js (app router y pages router). Segmentos dinámicos se omiten; los grupos (x) se aplanan.
export function detectRoutes(projectDir) {
  const pages = new Set(); const apis = new Set();
  for (const base of ['app', 'src/app']) {
    const root = path.join(projectDir, base);
    for (const f of walk(root)) {
      const rel = path.relative(root, f).replaceAll('\\', '/');
      const m = /^(.*?)(?:^|\/)(page|route)\.(?:tsx|ts|jsx|js|mdx)$/.exec(rel);
      if (!m) continue;
      const segs = m[1].split('/').filter(Boolean).filter((s) => !/^\(.*\)$/.test(s) && !s.startsWith('@'));
      if (segs.some((s) => s.startsWith('[') || s.startsWith('_'))) continue;
      const route = `/${segs.join('/')}`;
      (m[2] === 'route' || segs[0] === 'api' ? apis : pages).add(route);
    }
  }
  for (const base of ['pages', 'src/pages']) {
    const root = path.join(projectDir, base);
    for (const f of walk(root)) {
      const rel = path.relative(root, f).replaceAll('\\', '/').replace(/\.(?:tsx|ts|jsx|js|mdx)$/, '');
      if (!/\.(?:tsx|ts|jsx|js|mdx)$/.test(f) || /(^|\/)_/.test(rel) || /\[/.test(rel)) continue;
      const route = `/${rel.replace(/(^|\/)index$/, '')}`.replace(/\/$/, '') || '/';
      (rel.startsWith('api/') ? apis : pages).add(route);
    }
  }
  if (!pages.size) for (const f of ['index.html', 'public/index.html']) if (fs.existsSync(path.join(projectDir, f))) pages.add('/');
  return { pages: [...pages].sort(), apis: [...apis].sort() };
}

export function detectStack(projectDir) {
  const pkgPath = path.join(projectDir, 'package.json');
  const pkg = fs.existsSync(pkgPath) ? JSON.parse(fs.readFileSync(pkgPath, 'utf8')) : {};
  const deps = { ...pkg.dependencies, ...pkg.devDependencies };
  const has = (n) => Object.prototype.hasOwnProperty.call(deps, n);
  const vercelProject = (() => { try { return JSON.parse(fs.readFileSync(path.join(projectDir, '.vercel', 'project.json'), 'utf8')).projectName ?? null; } catch { return null; } })();
  return {
    name: pkg.name ?? path.basename(projectDir),
    framework: has('next') ? 'next' : has('astro') ? 'astro' : has('@sveltejs/kit') ? 'sveltekit' : has('nuxt') ? 'nuxt' : has('vite') ? 'vite' : has('react') ? 'react' : fs.existsSync(path.join(projectDir, 'index.html')) ? 'static' : 'unknown',
    supabase: has('@supabase/supabase-js') || has('@supabase/ssr') || fs.existsSync(path.join(projectDir, 'supabase')),
    vercel: fs.existsSync(path.join(projectDir, 'vercel.json')) || fs.existsSync(path.join(projectDir, '.vercel')),
    vercelProject,
    husky: fs.existsSync(path.join(projectDir, '.husky')),
    lefthook: ['lefthook.yml', 'lefthook.yaml', '.lefthook.yml'].some((f) => fs.existsSync(path.join(projectDir, f))),
    devPort: /--port\s+(\d+)|-p\s+(\d+)/.exec(pkg.scripts?.dev ?? '')?.slice(1).find(Boolean) ?? (has('vite') && !has('next') ? '5173' : has('astro') ? '4321' : '3000')
  };
}

export function proposeConfigs(projectDir) {
  const stack = detectStack(projectDir);
  const { pages, apis } = detectRoutes(projectDir);
  const baseUrl = `http://localhost:${stack.devPort}`;
  const allowedHosts = ['localhost', '127.0.0.1'];
  if (stack.vercelProject) allowedHosts.push(`${stack.vercelProject}-*.vercel.app`);
  const routes = pages.length ? pages.filter((r) => !PROTECTED_WORDS.test(r)).slice(0, 12) : ['/'];
  const protectedPages = pages.filter((r) => PROTECTED_WORDS.test(r) && !AUTH_WORDS.test(r));
  // Solo APIs que el nombre delata como privadas; las demás se revisan a mano (api-route-no-auth) en vez de asumir "denied".
  const protectedApis = apis.filter((r) => PROTECTED_WORDS.test(r) && !AUTH_WORDS.test(r) && !/webhook|health|status|cron/.test(r));
  const staticDirs = ['app', 'src', 'pages', 'components', 'styles', 'public'].filter((d) => fs.existsSync(path.join(projectDir, d)));

  const ui = { baseUrl, allowedHosts, routes: routes.length ? routes : ['/'], devices: ['iPhone SE', 'iPhone 13', 'Pixel 7', 'iPad Pro 11', 'Desktop Chrome 1440'], staticDirs: staticDirs.length ? staticDirs : ['.'] };
  const security = {
    baseUrl, routes: ['/', ...protectedPages.slice(0, 3)].filter((v, i, a) => a.indexOf(v) === i), allowedHosts,
    policy: { offlineOnly: false, fixAllowed: true, productionHosts: [] },
    scanDir: '.', requiredTools: ['gitleaks', 'osv-scanner'], semgrepConfigs: ['p/owasp-top-ten', 'p/typescript'], zap: { enabled: false, minutes: 1 },
    ignoreDirs: ['node_modules', '.next', '.git', 'dist', 'build', 'coverage', '.vercel', '.ui-audit', '.security-audit', '.ux-audit', '.audit', '.codex', '.cursor', '.claude', '.agents'],
    sensitivePaths: ['/.env', '/.git/HEAD']
  };
  const journeys = {
    baseUrl, allowedHosts, loginPathRegex: 'login|signin|sign-in|auth|ingresar',
    personas: [
      { id: 'visitante', label: 'Visitante anónimo (celular)', devices: ['iPhone 13', 'Pixel 7', 'Desktop Chrome 1440'], auth: null },
      ...(protectedPages.length ? [{ id: 'admin', label: 'Admin', devices: ['iPad Pro 11', 'Desktop Chrome 1440'], auth: { storageState: '.auth/admin.json', loginUrl: pages.find((p) => /login|ingresar|signin/.test(p)) ?? '/login', emailSelector: 'input[type=email]', passwordSelector: 'input[type=password]', submitSelector: 'button[type=submit]', emailEnv: 'TEST_ADMIN_EMAIL', passwordEnv: 'TEST_ADMIN_PASSWORD' } }] : [])
    ],
    journeys: [{ id: 'home-cta', persona: 'visitante', goal: 'Entender la propuesta y llegar a la acción principal (COMPLETAR con el flujo real)', budget: { maxInteractions: 6, maxMs: 30000 }, steps: [{ action: 'goto', url: '/' }, { action: 'expectVisible', selector: 'main, body' }] }],
    accessChecks: [
      ...protectedPages.map((r) => ({ persona: 'visitante', type: 'page', route: r, expect: 'denied' })),
      ...protectedApis.slice(0, 10).map((r) => ({ persona: 'visitante', type: 'api', route: r, expect: 'denied' }))
    ]
  };
  return { stack, routes: { pages, apis, protectedPages, protectedApis }, configs: { ui, security, journeys } };
}

export function guardHookCommand() {
  const cli = path.join(KIT_ROOT, 'cli', 'ui-audit.mjs');
  const viaNpx = /[\\/]_npx[\\/]/.test(cli);
  let version = '0.0.0';
  try { version = JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8')).version; } catch { /* sin versión */ }
  return viaNpx ? `npx -y @chimichurria/audit@${version} guard --staged` : `node "${cli}" guard --staged`;
}

export function initProject(projectDir, { dryRun = true, force = false } = {}) {
  const proposal = proposeConfigs(projectDir);
  const actions = [];
  for (const [k, file] of Object.entries(CONFIG_FILES)) {
    const p = path.join(projectDir, file);
    if (fs.existsSync(p) && !force) { actions.push({ file, action: 'keep', reason: 'ya existe (usá force para regenerar)' }); continue; }
    actions.push({ file, action: fs.existsSync(p) ? 'overwrite' : 'create' });
    if (!dryRun) fs.writeFileSync(p, `${JSON.stringify(proposal.configs[k], null, 2)}\n`);
  }
  const giPath = path.join(projectDir, '.gitignore');
  const gi = fs.existsSync(giPath) ? fs.readFileSync(giPath, 'utf8') : '';
  const missing = GITIGNORE_LINES.filter((l) => !gi.split('\n').map((x) => x.trim()).includes(l));
  if (missing.length) {
    actions.push({ file: '.gitignore', action: 'append', lines: missing });
    if (!dryRun) fs.writeFileSync(giPath, `${gi}${gi && !gi.endsWith('\n') ? '\n' : ''}\n# ui-audit (reportes y sesiones de prueba: pueden contener datos sensibles)\n${missing.join('\n')}\n`);
  }
  const cmd = guardHookCommand();
  const hookLine = `${HOOK_MARK}\n${cmd} || exit 1\n`;
  if (proposal.stack.lefthook) actions.push({ file: 'lefthook.yml', action: 'manual', reason: `Agregá a pre-commit: ${cmd}` });
  else {
    // Con worktrees .git es un archivo: la carpeta real de hooks la da git.
    const gitHooks = fs.existsSync(path.join(projectDir, '.git')) ? spawnSync('git', ['rev-parse', '--path-format=absolute', '--git-path', 'hooks'], { cwd: projectDir, encoding: 'utf8' }).stdout.trim() : '';
    const hookFile = proposal.stack.husky ? path.join(projectDir, '.husky', 'pre-commit') : path.join(gitHooks, 'pre-commit');
    if (!proposal.stack.husky && !gitHooks) actions.push({ file: '.git/hooks/pre-commit', action: 'skip', reason: 'la carpeta no es la raíz de un repositorio git; agregá el guard a mano en el pre-commit' });
    else {
      const existing = fs.existsSync(hookFile) ? fs.readFileSync(hookFile, 'utf8') : '';
      if (existing.includes(HOOK_MARK)) actions.push({ file: path.relative(projectDir, hookFile), action: 'keep', reason: 'guard ya instalado' });
      else {
        actions.push({ file: path.relative(projectDir, hookFile), action: existing ? 'append' : 'create', command: cmd });
        if (!dryRun) {
          fs.mkdirSync(path.dirname(hookFile), { recursive: true });
          fs.writeFileSync(hookFile, existing ? `${existing}${existing.endsWith('\n') ? '' : '\n'}${hookLine}` : `#!/bin/sh\n${hookLine}`);
          fs.chmodSync(hookFile, 0o755);
        }
      }
    }
  }
  return { dryRun, ...proposal, actions, next: [
    'Revisá baseUrl (preview de Vercel o local) y allowedHosts: solo hosts propios o con autorización escrita.',
    'Si el proyecto es de un cliente corporativo con restricciones, poné policy.offlineOnly: true en ui-audit.security.json.',
    'Completá ui-audit.journeys.json con los flujos reales de cada perfil y sus selectores (y las cuentas de prueba TEST_* en el entorno).',
    'Corré ui-audit doctor y ui-audit doctor --security.'
  ] };
}
