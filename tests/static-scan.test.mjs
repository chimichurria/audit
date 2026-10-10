import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { scanText, scanTree } from '../scripts/audit/static-scan.mjs';

const ids = (t, f) => scanText(t, f).map((h) => h.id);

test('reglas de UI', () => {
  assert.ok(ids('<meta name="viewport" content="width=device-width, user-scalable=no">', 'a.html').includes('viewport-zoom-disabled'));
  assert.ok(ids('<html><head></head></html>', 'a.html').includes('viewport-missing'));
  assert.ok(ids('input { font-size: 12px; }', 'a.css').includes('input-font-small'));
  assert.ok(!ids('input { font-size: 16px; }', 'a.css').includes('input-font-small'));
  assert.ok(ids('.a { height: 100vh }', 'a.css').includes('vh-100'));
  assert.ok(ids('.a { width: 900px }', 'a.css').includes('fixed-width-large'));
  assert.ok(!ids('.a { max-width: 900px }', 'a.css').includes('fixed-width-large'));
  assert.ok(ids('.a:focus { outline: none }', 'a.css').includes('outline-none'));
  assert.ok(!ids('.a:focus { outline: none } .a:focus-visible { outline: 2px solid }', 'a.css').includes('outline-none'));
  assert.ok(ids('<img src="x.png">', 'a.tsx').includes('img-no-alt'));
  assert.ok(!ids('<img src="x.png" alt="">', 'a.tsx').includes('img-no-alt'));
  assert.ok(ids('<div onClick={go}>x</div>', 'a.tsx').includes('click-on-div'));
  assert.ok(!ids('<div role="button" onClick={go}>x</div>', 'a.tsx').includes('click-on-div'));
});

test('ui-audit-ignore exige motivo', () => {
  assert.ok(!ids('/* ui-audit-ignore: vh-100 — pantalla de kiosco fija */\n.a { height: 100vh }', 'a.css').includes('vh-100'));
  assert.ok(ids('/* ui-audit-ignore: vh-100 */\n.a { height: 100vh }', 'a.css').includes('vh-100'));
});

test('fixtures broken vs ok', () => {
  const root = path.resolve('fixtures/ui');
  const broken = scanTree(path.join(root, 'broken')).findings.map((f) => f.id);
  for (const id of ['viewport-zoom-disabled', 'img-no-alt', 'input-font-small', 'vh-100', 'fixed-width-large', 'outline-none']) assert.ok(broken.includes(id), id);
  const ok = scanTree(path.join(root, 'ok')).findings.filter((f) => ['P0', 'P1'].includes(f.severity));
  assert.deepEqual(ok, []);
});
