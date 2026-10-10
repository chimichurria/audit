import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { initProject, detectRoutes } from '../lib/init.mjs';
import { install } from '../lib/install.mjs';

function nextApp() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'init-'));
  spawnSync('git', ['init', '-q'], { cwd: dir });
  fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'demo', dependencies: { next: '15.0.0', '@supabase/supabase-js': '2.0.0' } }));
  for (const f of ['app/page.tsx', 'app/(marketing)/precios/page.tsx', 'app/admin/page.tsx', 'app/login/page.tsx', 'app/productos/[id]/page.tsx', 'app/api/admin/usuarios/route.ts', 'app/api/webhook/meta/route.ts', 'app/admin/login/page.tsx', 'app/admin/auth/confirm/route.ts', 'app/auth/callback/route.ts', 'app/api/availability/route.ts']) {
    fs.mkdirSync(path.join(dir, path.dirname(f)), { recursive: true });
    fs.writeFileSync(path.join(dir, f), 'export default function P() { return null }\n');
  }
  return dir;
}

test('init detecta rutas y protegidas; dryRun no escribe; write sí y es idempotente', () => {
  const dir = nextApp();
  const routes = detectRoutes(dir);
  assert.deepEqual(routes.pages, ['/', '/admin', '/admin/login', '/login', '/precios']);
  assert.deepEqual(routes.apis, ['/admin/auth/confirm', '/api/admin/usuarios', '/api/availability', '/api/webhook/meta', '/auth/callback']);
  const plan = initProject(dir);
  assert.equal(plan.stack.framework, 'next');
  assert.ok(plan.configs.journeys.accessChecks.some((c) => c.route === '/admin' && c.expect === 'denied'));
  assert.ok(plan.configs.journeys.accessChecks.some((c) => c.route === '/api/admin/usuarios'));
  assert.ok(!plan.configs.journeys.accessChecks.some((c) => c.route === '/api/webhook/meta'));
  // rutas públicas a propósito (auth, callbacks, APIs públicas) nunca se esperan "denied"
  for (const publica of ['/admin/login', '/login', '/admin/auth/confirm', '/auth/callback', '/api/availability']) assert.ok(!plan.configs.journeys.accessChecks.some((c) => c.route === publica), publica);
  assert.ok(!fs.existsSync(path.join(dir, 'ui-audit.config.json')));
  initProject(dir, { dryRun: false });
  for (const f of ['ui-audit.config.json', 'ui-audit.security.json', 'ui-audit.journeys.json']) assert.ok(fs.existsSync(path.join(dir, f)), f);
  assert.match(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8'), /\.auth\//);
  const hook = fs.readFileSync(path.join(dir, '.git', 'hooks', 'pre-commit'), 'utf8');
  assert.match(hook, /guard --staged/);
  const again = initProject(dir, { dryRun: false });
  assert.ok(again.actions.every((a) => ['keep'].includes(a.action)), JSON.stringify(again.actions));
});

test('install codex+cursor escribe MCP, skills compartidas y bloque AGENTS.md idempotente', () => {
  const dir = nextApp();
  install(dir, 'all', { dryRun: false });
  install(dir, 'all', { dryRun: false });
  assert.match(fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8'), /\[mcp_servers\.ui-audit\][\s\S]*tool_timeout_sec = 120/);
  assert.equal((fs.readFileSync(path.join(dir, '.codex', 'config.toml'), 'utf8').match(/\[mcp_servers\.ui-audit\]/g) ?? []).length, 1);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.cursor', 'mcp.json'), 'utf8')).mcpServers['ui-audit']);
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, '.mcp.json'), 'utf8')).mcpServers['ui-audit']);
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'skills', 'app-audit-full', 'SKILL.md')));
  assert.ok(fs.existsSync(path.join(dir, '.cursor', 'rules', 'ui-audit.mdc')));
  assert.equal((fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8').match(/ui-audit:start/g) ?? []).length, 1);
});

test('todas las skills tienen frontmatter name/description válido (Agent Skills)', () => {
  for (const name of fs.readdirSync('skills')) {
    const t = fs.readFileSync(path.join('skills', name, 'SKILL.md'), 'utf8');
    const fm = /^---\n([\s\S]*?)\n---\n/.exec(t)?.[1] ?? '';
    assert.match(fm, new RegExp(`^name: ${name}$`, 'm'), name);
    assert.match(fm, /^description: .{40,}$/m, name);
  }
});
