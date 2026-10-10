import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startSite, journeysConfig } from '../fixtures/ux/site.mjs';
import { runJourneys } from '../scripts/ux/run-journeys.mjs';

process.env.TEST_GUEST_NAME = 'Persona de Prueba';
process.env.TEST_GUEST_PHONE = '1100000000';

test('flujos por perfil: broken detecta fricción y acceso roto; ok queda sin P0/P1', { timeout: 180000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-'));
  const b = await startSite('broken');
  const g = await startSite('ok');
  try {
    const rb = await runJourneys({ projectDir: tmp, config: journeysConfig(b.url), outDir: path.join(tmp, 'b', 'run') });
    const ids = new Set(rb.findings.map((f) => f.id));
    for (const id of ['no-feedback-after-submit', 'input-no-label', 'tap-target-small', 'broken-access-control', 'input-keyboard-tel']) assert.ok(ids.has(id), `falta ${id}`);
    assert.ok(rb.findings.some((f) => f.id === 'broken-access-control' && f.severity === 'P0' && f.where === 'visitante → /admin'));
    assert.ok(rb.findings.some((f) => f.id === 'broken-access-control' && f.where === 'visitante → /api/rrpp'));
    assert.equal(rb.status, 'fail');
    const rg = await runJourneys({ projectDir: tmp, config: journeysConfig(g.url), outDir: path.join(tmp, 'g', 'run') });
    assert.deepEqual(rg.findings.filter((f) => ['P0', 'P1'].includes(f.severity)).map((f) => `${f.id}: ${f.title}`), []);
    assert.equal(rg.status, 'pass');
    assert.ok(rg.facts.every((f) => f.completed));
    assert.ok(rg.accessResults.every((a) => a.ok));
  } finally { await b.close(); await g.close(); }
});

test('variable de entorno faltante: el runner falla, no inventa datos', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ux-'));
  const g = await startSite('ok');
  const cfg = journeysConfig(g.url);
  cfg.journeys[0].steps[1].value = '{{TEST_VARIABLE_QUE_NO_EXISTE}}';
  cfg.accessChecks = [];
  try {
    const r = await runJourneys({ projectDir: tmp, config: cfg, outDir: path.join(tmp, 'r', 'run') });
    assert.ok(r.findings.some((f) => f.id === 'journey-failed' && /TEST_VARIABLE_QUE_NO_EXISTE/.test(f.title)));
  } finally { await g.close(); }
});
