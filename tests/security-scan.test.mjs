import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { scanText, findSecrets, scanTree } from '../scripts/security/security-scan.mjs';
import { hostAllowed } from '../scripts/security/headers-check.mjs';

const ids = (t, f = 'app/x.ts') => scanText(t, f).map((h) => h.id);
const b64u = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');

test('detecta secretos armados en runtime y no imprime el valor', () => {
  const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  const hit = scanText(`const k = "${aws}";`, 'a.ts').find((h) => h.id === 'secret-aws-access-key');
  assert.ok(hit);
  assert.ok(!hit.evidence.includes(aws));
});

test('detecta JWT service_role y no uno anon', () => {
  const mk = (role) => `eyJ${b64u({ alg: 'HS256' }).slice(3)}.${b64u({ role, iss: 'supabase' })}.${'x'.repeat(20)}`;
  assert.equal(findSecrets(mk('service_role')).length, 1);
  assert.equal(findSecrets(mk('anon')).length, 0);
});

test('reglas de código', () => {
  assert.ok(ids('eval(x)').includes('eval-dynamic'));
  assert.ok(ids('db.query(`select * from t where id=${id}`)').includes('sql-concat'));
  assert.ok(ids('<div dangerouslySetInnerHTML={{__html:h}}/>').includes('dangerous-html'));
  assert.ok(ids('const a = process.env.NEXT_PUBLIC_STRIPE_SECRET;').includes('public-env-secret'));
  assert.ok(!ids('const a = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;').includes('public-env-secret'));
  assert.ok(ids("'use client'\nconst k = process.env.SUPABASE_SERVICE_ROLE_KEY").includes('service-role-in-client'));
  assert.ok(!ids("import 'server-only'\nconst k = process.env.SUPABASE_SERVICE_ROLE_KEY").includes('service-role-in-client'));
  assert.ok(ids('try{a()}catch(e){}').includes('empty-catch'));
});

test('reglas de archivo', () => {
  assert.ok(ids('export async function POST(){}', 'app/api/x/route.ts').includes('api-route-no-auth'));
  assert.ok(!ids('const u = await supabase.auth.getUser()', 'app/api/x/route.ts').includes('api-route-no-auth'));
  assert.ok(!ids("'use server'\nimport { z } from 'zod'\nawait requireStaff(); z.parse(x)", 'src/actions.ts').includes('server-action-no-auth'));
  assert.ok(!ids('await requireAdmin()', 'app/api/x/route.ts').includes('api-route-no-auth'));
  assert.ok(ids("'use server'\nexport async function a(){}", 'src/actions.ts').includes('server-action-no-auth'));
  assert.ok(ids('export async function POST(){}', 'app/api/webhook/meta/route.ts').includes('webhook-no-signature'));
  assert.ok(!ids('crypto.timingSafeEqual(a,b)', 'app/api/webhook/meta/route.ts').includes('webhook-no-signature'));
  assert.ok(ids('X=1', '.env.local').includes('env-file'));
  assert.ok(!ids('X=', '.env.example').includes('env-file'));
});

test('security-audit-ignore exige motivo', () => {
  assert.ok(!ids('// security-audit-ignore: eval-dynamic — sandbox controlado\neval(x)').includes('eval-dynamic'));
  assert.ok(ids('// security-audit-ignore: eval-dynamic\neval(x)').includes('eval-dynamic'));
});

test('allowlist de hosts', () => {
  assert.ok(hostAllowed('mi-proyecto-git-x.vercel.app', ['mi-proyecto-*.vercel.app']));
  assert.ok(!hostAllowed('otro.vercel.app', ['mi-proyecto-*.vercel.app']));
  assert.ok(!hostAllowed('mi-proyecto-a.b.vercel.app', ['mi-proyecto-*.vercel.app']));
});

test('las reglas de código no se aplican a tests, docs ni prompts; los secretos sí en todos lados', () => {
  assert.ok(!ids('eval(x)', 'tests/unit/home.test.ts').includes('eval-dynamic'));
  assert.ok(!ids('Evitá eval(x) y dangerouslySetInnerHTML', 'docs/guia.md').includes('eval-dynamic'));
  assert.ok(!ids('prompt: nunca uses eval(x)', '.codex/agents/a.toml').includes('eval-dynamic'));
  const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
  assert.ok(ids(`const k = "${aws}"`, 'tests/unit/a.test.ts').includes('secret-aws-access-key'));
  assert.ok(ids(`clave: ${aws}`, 'docs/guia.md').includes('secret-aws-access-key'));
});

test('archivos ignorados por git (.env.local) no se marcan; un .env trackeado por error sí', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'scan-'));
  const git = (...a) => spawnSync('git', a, { cwd: dir, encoding: 'utf8' });
  git('init', '-q'); git('config', 'user.email', 't@e.com'); git('config', 'user.name', 'T');
  fs.writeFileSync(path.join(dir, '.gitignore'), '.env.local\n');
  fs.writeFileSync(path.join(dir, '.env.local'), 'SECRET=1\n');
  fs.writeFileSync(path.join(dir, '.env.production'), 'SECRET=2\n');
  git('add', '.gitignore', '.env.production');
  const files = scanTree(dir).findings.filter((f) => f.id === 'env-file').map((f) => f.file);
  assert.deepEqual(files, ['.env.production']);
});
