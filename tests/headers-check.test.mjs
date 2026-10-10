import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { checkHeaders } from '../scripts/security/headers-check.mjs';
const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
const listen = (h) => new Promise((r) => { const s = http.createServer(h); s.listen(0, '127.0.0.1', () => r(s)); });
const bad = (q, s) => {
  if (q.url === '/.env') { s.end('SECRET=abc123\nDB=1'); return; }
  if (q.url === '/app.js') { s.setHeader('content-type', 'text/javascript'); s.end(`var k="${aws}"`); return; }
  s.setHeader('access-control-allow-origin', q.headers.origin ?? '*'); s.setHeader('access-control-allow-credentials', 'true');
  s.setHeader('content-type', 'text/html'); s.end('<script src="/app.js"></script>');
};
const good = (q, s) => {
  for (const [k, v] of Object.entries({ 'content-security-policy': "default-src 'self'; frame-ancestors 'self'", 'x-content-type-options': 'nosniff', 'referrer-policy': 'no-referrer', 'permissions-policy': 'camera=()' })) s.setHeader(k, v);
  if (q.url === '/') { s.setHeader('content-type', 'text/html'); s.end('<p>ok</p>'); } else { s.statusCode = 404; s.end('not found'); }
};
test('bad vs good', async () => {
  const sb = await listen(bad); const sg = await listen(good);
  try {
    const rb = await checkHeaders({ baseUrl: `http://127.0.0.1:${sb.address().port}`, allowedHosts: ['127.0.0.1'] });
    const ids = rb.findings.map((f) => f.id);
    for (const id of ['csp-missing', 'nosniff-missing', 'clickjacking', 'cors-credentials-open', 'sensitive-file-exposed', 'secret-in-bundle']) assert.ok(ids.includes(id), id);
    const rg = await checkHeaders({ baseUrl: `http://127.0.0.1:${sg.address().port}`, allowedHosts: ['127.0.0.1'] });
    assert.deepEqual(rg.findings.filter((f) => ['P0', 'P1'].includes(f.severity)), []);
    await assert.rejects(() => checkHeaders({ baseUrl: 'https://example.com', allowedHosts: ['127.0.0.1'] }), /Host no permitido/);
  } finally { sb.close(); sg.close(); }
});
