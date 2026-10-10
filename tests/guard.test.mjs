import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { checkWrite } from '../lib/guard.mjs';
import { createFixBranch, commitStaged } from '../lib/git.mjs';

const CLI = path.resolve('cli/ui-audit.mjs');
const git = (cwd, ...a) => spawnSync('git', a, { cwd, encoding: 'utf8' });
function repo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'guard-'));
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'test@example.com');
  git(dir, 'config', 'user.name', 'Test');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 1;\n');
  git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'init');
  return dir;
}

test('checkWrite', () => {
  assert.equal(checkWrite({ file: '.env.production', content: 'A=1' }).allowed, false);
  assert.equal(checkWrite({ file: 'src/a.ts', content: `k="${'AKIA' + 'ABCDEFGHIJKLMNOP'}"` }).allowed, false);
  assert.equal(checkWrite({ file: 'scripts/audit/thresholds.json' }, { env: {} }).allowed, false);
  assert.equal(checkWrite({ file: 'src/a.ts', content: 'const a = 1' }).allowed, true);
});

test('guard --staged bloquea un commit con secreto y deja pasar uno limpio', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'keys.ts'), `export const k = "${'AKIA' + 'ABCDEFGHIJKLMNOP'}";\n`);
  git(dir, 'add', 'keys.ts');
  const bad = spawnSync('node', [CLI, 'guard', '--staged', '--dir', dir], { encoding: 'utf8' });
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /secreto/);
  assert.ok(!bad.stderr.includes('AKIA' + 'ABCDEFGHIJKLMNOP'));
  git(dir, 'rm', '-q', '--cached', 'keys.ts');
  fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 2;\n');
  git(dir, 'add', 'b.ts');
  assert.equal(spawnSync('node', [CLI, 'guard', '--staged', '--dir', dir]).status, 0);
});

test('rama de corrección y commit con guard; nunca en main', () => {
  const dir = repo();
  fs.writeFileSync(path.join(dir, 'b.ts'), 'export const b = 2;\n');
  git(dir, 'add', 'b.ts');
  assert.throws(() => commitStaged(dir, { message: 'fix: algo concreto' }), /rama de corrección/);
  assert.throws(() => createFixBranch(dir), /cambios sin commitear/);
  git(dir, 'reset', '-q');
  fs.rmSync(path.join(dir, 'b.ts'));
  const br = createFixBranch(dir, { date: '2026-01-01' });
  assert.equal(br.branch, 'audit/2026-01-01');
  fs.writeFileSync(path.join(dir, '.env.local'), 'A=1\n');
  git(dir, 'add', '-f', '.env.local');
  const blocked = commitStaged(dir, { message: 'fix: no debería pasar', findingIds: ['x'] });
  assert.equal(blocked.committed, false);
  git(dir, 'rm', '-q', '--cached', '.env.local');
  fs.writeFileSync(path.join(dir, 'a.ts'), 'export const a = 2;\n');
  git(dir, 'add', 'a.ts');
  const ok = commitStaged(dir, { message: 'fix(ui): ancho responsive', findingIds: ['horizontal-overflow'] });
  assert.equal(ok.committed, true);
  assert.match(git(dir, 'log', '-1', '--format=%B').stdout, /Hallazgos: horizontal-overflow/);
});
