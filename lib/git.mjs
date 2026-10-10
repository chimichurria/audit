// Operaciones git locales del loop de corrección. Nunca hace push.
import { spawnSync } from 'node:child_process';
import { checkStaged } from './guard.mjs';
import { today } from './common.mjs';

const git = (cwd, args) => spawnSync('git', args, { cwd, encoding: 'utf8' });
export const FIX_BRANCH_PREFIXES = ['audit/', 'security-audit/', 'ui-audit/', 'ux-audit/'];

export function currentBranch(cwd) { return git(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']).stdout.trim(); }

export function dirtyFiles(cwd) {
  const r = git(cwd, ['status', '--porcelain']);
  if (r.status !== 0) throw new Error(`No es un repositorio git: ${cwd}`);
  return r.stdout.split('\n').filter(Boolean);
}

export function createFixBranch(cwd, { prefix = 'audit/', date = today() } = {}) {
  if (!FIX_BRANCH_PREFIXES.includes(prefix)) throw new Error(`Prefijo de rama no permitido: ${prefix}`);
  const dirty = dirtyFiles(cwd);
  if (dirty.length) throw new Error(`El árbol de trabajo tiene cambios sin commitear (${dirty.length}). Commiteá o guardá (stash) antes de corregir:\n${dirty.slice(0, 10).join('\n')}`);
  const cur = currentBranch(cwd);
  if (FIX_BRANCH_PREFIXES.some((p) => cur.startsWith(p))) return { branch: cur, created: false };
  let name = `${prefix}${date}`;
  for (let i = 2; git(cwd, ['rev-parse', '--verify', '--quiet', name]).status === 0; i++) name = `${prefix}${date}-${i}`;
  const r = git(cwd, ['checkout', '-b', name]);
  if (r.status !== 0) throw new Error(r.stderr.trim());
  return { branch: name, created: true, from: cur };
}

// Commitea lo que está en el índice, tras pasar el guard. Exige estar en una rama de corrección.
export function commitStaged(cwd, { message, findingIds = [] }) {
  const branch = currentBranch(cwd);
  if (!FIX_BRANCH_PREFIXES.some((p) => branch.startsWith(p))) throw new Error(`Solo se commitea en una rama de corrección (${FIX_BRANCH_PREFIXES.join(', ')}). Rama actual: ${branch}. Usá audit_fix_branch.`);
  const staged = git(cwd, ['diff', '--cached', '--name-only']).stdout.split('\n').filter(Boolean);
  if (!staged.length) throw new Error('No hay cambios en el índice (git add).');
  const violations = checkStaged(cwd);
  if (violations.length) return { committed: false, violations };
  const body = findingIds.length ? `\n\nHallazgos: ${findingIds.join(', ')}` : '';
  const r = git(cwd, ['commit', '-m', `${message}${body}`]);
  if (r.status !== 0) throw new Error(r.stderr.trim() || r.stdout.trim());
  return { committed: true, branch, sha: git(cwd, ['rev-parse', '--short', 'HEAD']).stdout.trim(), files: staged };
}
