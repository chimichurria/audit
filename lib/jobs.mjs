// Jobs en segundo plano para el servidor MCP: una auditoría tarda minutos y los clientes cortan las herramientas (~60 s en Codex).
import crypto from 'node:crypto';

const jobs = new Map();

export function startJob(kind, fn) {
  const id = `${kind}-${crypto.randomUUID().slice(0, 8)}`;
  const job = { id, kind, state: 'running', startedAt: new Date().toISOString(), progress: [], result: null, error: null };
  jobs.set(id, job);
  const progress = (step, msg) => job.progress.push({ at: new Date().toISOString(), step, msg });
  Promise.resolve()
    .then(() => fn(progress))
    .then((r) => { job.result = r; job.state = 'done'; })
    .catch((e) => { job.error = String(e?.message ?? e); job.state = 'error'; })
    .finally(() => { job.finishedAt = new Date().toISOString(); });
  return job;
}

export const getJob = (id) => jobs.get(id);
export const listJobs = () => [...jobs.values()].map(({ id, kind, state, startedAt, finishedAt }) => ({ id, kind, state, startedAt, finishedAt }));

export async function waitJob(id, timeoutMs = 600000) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const j = jobs.get(id);
    if (!j) throw new Error(`Job inexistente: ${id}`);
    if (j.state !== 'running') return j;
    await new Promise((r) => setTimeout(r, 200));
  }
  throw new Error(`Timeout esperando ${id}`);
}
