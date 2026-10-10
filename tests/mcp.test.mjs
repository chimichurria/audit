import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { createServer } from '../mcp/server.mjs';

async function connect() {
  const server = createServer();
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: 'test', version: '0.0.0' });
  await Promise.all([server.connect(a), client.connect(b)]);
  return { client, close: async () => { await client.close(); await server.close(); } };
}
const json = (r) => JSON.parse(r.content[0].text);

test('el servidor MCP expone 10 herramientas, 5 prompts y la plantilla de reportes', async () => {
  const { client, close } = await connect();
  try {
    const tools = (await client.listTools()).tools.map((t) => t.name).sort();
    assert.deepEqual(tools, ['audit_diff', 'audit_doctor', 'audit_fix_branch', 'audit_fix_commit', 'audit_guard_check', 'audit_init', 'audit_report', 'audit_save_auth', 'audit_start', 'audit_status']);
    const prompts = (await client.listPrompts()).prompts.map((p) => p.name).sort();
    assert.deepEqual(prompts, ['fix', 'full', 'security', 'ux-flows', 'verify']);
    const full = await client.getPrompt({ name: 'full', arguments: { projectDir: '/tmp/x' } });
    assert.match(full.messages[0].content.text, /audit_start/);
    assert.match(full.messages[0].content.text, /Reglas de oro/);
    const templates = (await client.listResourceTemplates()).resourceTemplates.map((t) => t.uriTemplate);
    assert.ok(templates.includes('ui-audit://report/{dimension}/{tag}'));
  } finally { await close(); }
});

test('audit_start security offline sobre el fixture → done con los ids esperados; audit_report lo devuelve', { timeout: 60000 }, async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  fs.cpSync(path.resolve('fixtures/security/vulnerable'), tmp, { recursive: true });
  fs.writeFileSync(path.join(tmp, 'ui-audit.security.json'), JSON.stringify({ allowedHosts: ['127.0.0.1'], requiredTools: [] }));
  const { client, close } = await connect();
  try {
    const started = json(await client.callTool({ name: 'audit_start', arguments: { projectDir: tmp, dimension: 'security', tag: 'before', offline: true } }));
    assert.ok(started.jobId);
    const st = json(await client.callTool({ name: 'audit_status', arguments: { jobId: started.jobId, waitSeconds: 30 } }));
    assert.equal(st.state, 'done', JSON.stringify(st));
    assert.equal(st.result.status, 'fail');
    assert.ok(st.result.top.some((t) => /sql-concat/.test(t)));
    const rep = await client.callTool({ name: 'audit_report', arguments: { projectDir: tmp, dimension: 'security', tag: 'before', format: 'json' } });
    assert.ok(json(rep).findings.some((f) => f.id === 'service-role-in-client'));
  } finally { await close(); }
});

test('audit_guard_check bloquea secretos y .env; política rechaza hosts ajenos sin hacer requests', async () => {
  const { client, close } = await connect();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  fs.writeFileSync(path.join(tmp, 'ui-audit.security.json'), JSON.stringify({ baseUrl: 'https://example.com', allowedHosts: ['localhost'] }));
  try {
    const g1 = json(await client.callTool({ name: 'audit_guard_check', arguments: { file: 'src/a.ts', content: `const k = "${'AKIA' + 'ABCDEFGHIJKLMNOP'}"` } }));
    assert.equal(g1.allowed, false);
    assert.ok(!JSON.stringify(g1).includes('AKIA' + 'ABCDEFGHIJKLMNOP'));
    assert.equal(json(await client.callTool({ name: 'audit_guard_check', arguments: { file: '.env', content: 'A=1' } })).allowed, false);
    const r = await client.callTool({ name: 'audit_start', arguments: { projectDir: tmp, dimension: 'security' } });
    assert.equal(r.isError, true);
    assert.match(r.content[0].text, /Host no permitido/);
    const p = await client.callTool({ name: 'audit_start', arguments: { projectDir: '/no/existe/ui-audit' } });
    assert.equal(p.isError, true);
  } finally { await close(); }
});

test('offlineOnly: ninguna dimensión sale a la red aunque se pida', { timeout: 60000 }, async () => {
  const http = await import('node:http');
  let hits = 0;
  const srv = http.createServer((q, s) => { hits++; s.end('x'); });
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const url = `http://127.0.0.1:${srv.address().port}`;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'mcp-'));
  fs.writeFileSync(path.join(tmp, 'ui-audit.security.json'), JSON.stringify({ baseUrl: url, allowedHosts: ['127.0.0.1'], policy: { offlineOnly: true }, requiredTools: [] }));
  fs.writeFileSync(path.join(tmp, 'ui-audit.config.json'), JSON.stringify({ baseUrl: url, routes: ['/'] }));
  fs.writeFileSync(path.join(tmp, 'ui-audit.journeys.json'), JSON.stringify({ baseUrl: url, personas: [{ id: 'v', devices: ['iPhone 13'] }], journeys: [{ id: 'j', persona: 'v', goal: 'g', steps: [{ action: 'goto', url: '/' }] }], accessChecks: [{ persona: 'v', type: 'page', route: '/admin', expect: 'denied' }] }));
  const { client, close } = await connect();
  try {
    const started = json(await client.callTool({ name: 'audit_start', arguments: { projectDir: tmp, dimension: 'full', offline: false, zap: true } }));
    assert.ok(started.policyNotes.some((n) => /offlineOnly/.test(n)));
    const st = json(await client.callTool({ name: 'audit_status', arguments: { jobId: started.jobId, waitSeconds: 40 } }));
    assert.equal(st.state, 'done', JSON.stringify(st));
    assert.equal(hits, 0, 'no debe haber requests al servidor');
    assert.ok(fs.existsSync(path.join(tmp, '.audit')));
  } finally { await close(); srv.close(); }
});
