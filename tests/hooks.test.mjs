import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';
const run = (hook, payload, env = {}) => spawnSync('node', [`scripts/hooks/${hook}.mjs`], { input: JSON.stringify(payload), encoding: 'utf8', env: { ...process.env, UIAUDIT_HOOK_PROFILE: 'standard', SECAUDIT_ALLOW_DETECTOR_EDIT: '', UIAUDIT_ALLOW_DETECTOR_EDIT: '', ...env } });
const aws = 'AKIA' + 'ABCDEFGHIJKLMNOP';
test('protect-secrets', () => {
  assert.equal(run('protect-secrets', { tool_input: { file_path: '.env.local', content: 'A=1' } }).status, 2);
  assert.equal(run('protect-secrets', { tool_input: { file_path: '.env.example', content: 'A=' } }).status, 0);
  assert.equal(run('protect-secrets', { tool_input: { file_path: 'scripts/security/security-scan.mjs', content: 'x' } }).status, 2);
  assert.equal(run('protect-secrets', { tool_input: { file_path: 'scripts/security/security-scan.mjs', content: 'x' } }, { SECAUDIT_ALLOW_DETECTOR_EDIT: '1' }).status, 0);
  assert.equal(run('protect-secrets', { tool_input: { file_path: 'src/a.ts', content: `k="${aws}"` } }).status, 2);
  assert.equal(run('protect-secrets', { tool_input: { file_path: 'src/a.ts', edits: [{ new_string: `k="${aws}"` }] } }).status, 2);
  assert.equal(run('protect-secrets', { tool_input: { file_path: 'src/a.ts', content: 'const a=1' } }).status, 0);
  assert.equal(run('protect-secrets', { tool_input: { file_path: '.env.local', content: 'A=1' } }, { UIAUDIT_HOOK_PROFILE: 'off' }).status, 0);
});
test('protect-detectors (Parte 1)', () => {
  assert.equal(run('protect-detectors', { tool_input: { file_path: 'scripts/audit/thresholds.json' } }).status, 2);
  assert.equal(run('protect-detectors', { tool_input: { file_path: 'tools/ui-audit/run-audit.mjs' } }).status, 2);
  assert.equal(run('protect-detectors', { tool_input: { file_path: 'scripts/audit/thresholds.json' } }, { UIAUDIT_ALLOW_DETECTOR_EDIT: '1' }).status, 0);
  assert.equal(run('protect-detectors', { tool_input: { file_path: 'src/app/page.tsx' } }).status, 0);
});
test('security-check', () => {
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/a.ts', 'eval(x)');
  const std = run('security-check', { tool_input: { file_path: 'tmp/a.ts' } });
  assert.equal(std.status, 0);
  assert.match(JSON.parse(std.stdout).hookSpecificOutput.additionalContext, /eval-dynamic/);
  assert.equal(run('security-check', { tool_input: { file_path: 'tmp/a.ts' } }, { UIAUDIT_HOOK_PROFILE: 'strict' }).status, 2);
  const off = run('security-check', { tool_input: { file_path: 'tmp/a.ts' } }, { UIAUDIT_HOOK_PROFILE: 'off' });
  assert.equal(off.status, 0); assert.equal(off.stdout, '');
});
test('ui-static-check (Parte 1)', () => {
  fs.mkdirSync('tmp', { recursive: true });
  fs.writeFileSync('tmp/a.html', '<html><head><meta name="viewport" content="width=device-width, user-scalable=no"></head><body><img src="x.png"></body></html>');
  const std = run('ui-static-check', { tool_input: { file_path: 'tmp/a.html' } });
  assert.equal(std.status, 0);
  assert.match(JSON.parse(std.stdout).hookSpecificOutput.additionalContext, /img-no-alt/);
  assert.equal(run('ui-static-check', { tool_input: { file_path: 'tmp/a.html' } }, { UIAUDIT_HOOK_PROFILE: 'strict' }).status, 2);
});
