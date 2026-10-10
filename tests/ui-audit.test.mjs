import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { serve } from '../fixtures/serve.mjs';
import { runUiAudit } from '../scripts/audit/run-audit.mjs';

const policy = { allowedHosts: ['127.0.0.1'], productionHosts: [], offlineOnly: false, fixAllowed: true };
const devices = ['iPhone 13', 'Desktop Chrome 1440'];

test('auditoría de UI: broken falla con los ids esperados, ok pasa sin P0/P1', { timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-'));
  const b = await serve(path.resolve('fixtures/ui/broken'));
  const g = await serve(path.resolve('fixtures/ui/ok'));
  try {
    const rb = await runUiAudit({ projectDir: path.resolve('fixtures/ui/broken'), config: { baseUrl: b.url, routes: ['/'], devices }, outDir: path.join(tmp, 'b', 'run'), policy });
    const ids = new Set(rb.findings.map((f) => f.id));
    for (const id of ['horizontal-overflow', 'tap-target-tiny', 'font-too-small', 'img-broken', 'viewport-zoom-disabled', 'axe-image-alt', 'axe-color-contrast']) assert.ok(ids.has(id), `falta ${id}`);
    assert.equal(rb.status, 'fail');
    const rg = await runUiAudit({ projectDir: path.resolve('fixtures/ui/ok'), config: { baseUrl: g.url, routes: ['/'], devices }, outDir: path.join(tmp, 'g', 'run'), policy });
    const blocking = rg.findings.filter((f) => ['P0', 'P1'].includes(f.severity));
    assert.deepEqual(blocking.map((f) => `${f.id} ${f.where} ${f.evidence}`), []);
    assert.equal(rg.status, 'pass');
    assert.ok(fs.existsSync(path.join(tmp, 'g', 'latest', 'report.md')));
  } finally { await b.close(); await g.close(); }
});

test('host fuera de allowedHosts se rechaza antes de abrir el navegador', async () => {
  await assert.rejects(() => runUiAudit({ config: { baseUrl: 'https://example.com' }, outDir: path.join(os.tmpdir(), 'x'), policy }), /Host no permitido/);
});

test('offline: no aprueba solo con el escaneo estático', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ui-audit-'));
  const r = await runUiAudit({ projectDir: path.resolve('fixtures/ui/ok'), config: { baseUrl: 'http://127.0.0.1:9' }, offline: true, outDir: path.join(tmp, 'r'), policy });
  assert.equal(r.status, 'incomplete');
});
