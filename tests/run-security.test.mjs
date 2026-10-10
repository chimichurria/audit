import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { runSecurity } from '../scripts/security/run-security.mjs';
import { enforce, validateAllowedHosts } from '../lib/policy.mjs';

const policy = { allowedHosts: ['127.0.0.1'], productionHosts: [], offlineOnly: false, fixAllowed: true };

test('run-security --offline sobre el fixture vulnerable: fail con los ids esperados', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
  const app = path.join(tmp, 'app');
  fs.cpSync(path.resolve('fixtures/security/vulnerable'), app, { recursive: true });
  fs.writeFileSync(path.join(app, 'lib', 'keys.ts'), `export const k = "${'AKIA' + 'ABCDEFGHIJKLMNOP'}";\n`); // secreto falso armado en runtime
  const r = await runSecurity({ projectDir: app, config: {}, offline: true, outDir: path.join(tmp, 'out', 'run'), policy });
  const ids = new Set(r.findings.map((f) => f.id));
  for (const id of ['sql-concat', 'eval-dynamic', 'service-role-in-client', 'dangerous-html', 'token-in-webstorage', 'webhook-no-signature', 'api-route-no-auth', 'secret-aws-access-key']) assert.ok(ids.has(id), `falta ${id}`);
  assert.equal(r.status, 'fail');
  assert.equal(r.tools['osv-scanner'], 'skipped: --offline');
  const md = fs.readFileSync(path.join(tmp, 'out', 'run', 'report.md'), 'utf8');
  assert.ok(!md.includes('AKIA' + 'ABCDEFGHIJKLMNOP'), 'el reporte no debe contener el secreto');
});

test('sin hallazgos bloqueantes pero sin herramientas requeridas → incomplete (nunca pass en silencio)', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sec-'));
  fs.writeFileSync(path.join(tmp, 'index.ts'), 'export const a = 1;\n');
  const r = await runSecurity({ projectDir: tmp, config: { requiredTools: ['gitleaks-que-no-existe'] }, offline: true, outDir: path.join(tmp, 'o', 'r'), policy });
  assert.equal(r.status, 'incomplete');
});

test('política: offlineOnly fuerza offline, producción es solo lectura, comodines públicos rechazados', () => {
  const off = enforce({ offline: false, zap: true, baseUrl: 'https://cualquiera.example' }, { ...policy, offlineOnly: true });
  assert.equal(off.offline, true); assert.equal(off.network, false); assert.equal(off.zap, false);
  const prod = enforce({ baseUrl: 'https://mi-dominio.com', zap: true }, { ...policy, allowedHosts: ['mi-dominio.com'], productionHosts: ['mi-dominio.com'] });
  assert.equal(prod.readOnly, true); assert.equal(prod.zap, false); assert.equal(prod.fixAllowed, false);
  assert.throws(() => enforce({ baseUrl: 'https://otro.com' }, policy), /Host no permitido/);
  assert.ok(validateAllowedHosts(['*.vercel.app']).length);
  assert.deepEqual(validateAllowedHosts(['mi-proyecto-*.vercel.app', 'localhost']), []);
});
