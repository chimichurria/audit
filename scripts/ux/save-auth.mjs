#!/usr/bin/env node
// Inicia sesión con una CUENTA DE PRUEBA y guarda storageState. Uso: node save-auth.mjs <personaId> [config]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { chromium } from 'playwright';
import { readJson, isMain } from '../../lib/common.mjs';
import { loadPolicy, assertHostAllowed } from '../../lib/policy.mjs';

export async function saveAuth({ projectDir = '.', config: cfg, personaId }) {
  const persona = (cfg.personas ?? []).find((p) => p.id === personaId);
  if (!persona?.auth) throw new Error(`Persona sin auth: ${personaId}`);
  const a = persona.auth;
  const pol = loadPolicy(projectDir, cfg.allowedHosts);
  if (pol.offlineOnly) throw new Error('policy.offlineOnly: no se inicia sesión contra ninguna URL.');
  const base = new URL(process.env.AUDIT_BASE_URL ?? cfg.baseUrl);
  assertHostAllowed(base.href, pol);
  if (spawnSync('git', ['check-ignore', '-q', a.storageState], { cwd: projectDir }).status !== 0) throw new Error(`${a.storageState} debe estar en .gitignore antes de guardar sesiones.`);
  const email = process.env[a.emailEnv]; const password = process.env[a.passwordEnv];
  if (!email || !password) throw new Error(`Faltan ${a.emailEnv} / ${a.passwordEnv} en el entorno (usá una cuenta de prueba).`);

  const browser = await chromium.launch();
  try {
    const ctx = await browser.newContext();
    const page = await ctx.newPage();
    await page.goto(new URL(a.loginUrl, base).href);
    await page.fill(a.emailSelector, email);
    await page.fill(a.passwordSelector, password);
    await page.click(a.submitSelector);
    await page.waitForURL((u) => !new RegExp(cfg.loginPathRegex ?? 'login', 'i').test(u.pathname), { timeout: 20000 });
    const ss = path.resolve(projectDir, a.storageState);
    fs.mkdirSync(path.dirname(ss), { recursive: true });
    await ctx.storageState({ path: ss });
    return { persona: personaId, storageState: a.storageState };
  } finally { await browser.close(); }
}

if (isMain(import.meta.url)) {
  try {
    const r = await saveAuth({ projectDir: '.', config: readJson(process.argv[3] ?? 'ui-audit.journeys.json'), personaId: process.argv[2] });
    console.log(`Sesión de prueba guardada en ${r.storageState}`);
  } catch (e) { console.error(e.message); process.exit(1); }
}
