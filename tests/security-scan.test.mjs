import test from 'node:test';
import assert from 'node:assert/strict';
import { scanText, findSecrets } from '../scripts/security/security-scan.mjs';
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
