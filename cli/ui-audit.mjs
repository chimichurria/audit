#!/usr/bin/env node
// CLI único del kit. Los mismos comandos que expone el servidor MCP.
import path from 'node:path';
import { readJson, today, summarize } from '../lib/common.mjs';
import { CONFIG_FILES, loadConfigs } from '../lib/project.mjs';
import { doctorUi, doctorSecurity, formatChecks } from '../lib/doctor.mjs';
import { initProject } from '../lib/init.mjs';
import { install, kitVersion } from '../lib/install.mjs';
import { checkStaged, checkWrite } from '../lib/guard.mjs';
import { createFixBranch } from '../lib/git.mjs';

const HELP = `ui-audit ${kitVersion()} — auditoría de UI, seguridad y flujos UX por perfil

Uso: ui-audit <comando> [opciones]   (se ejecuta en la carpeta del proyecto, o con --dir <ruta>)

  init [--write] [--force]          Detecta el stack y propone las 3 configs + .gitignore + guard pre-commit (sin --write solo muestra)
  doctor [--security]               Verifica herramientas, navegadores, config y .gitignore
  ui | security | ux [--tag t] [--offline] [--baseline <tag>] [--zap]
                                    Mide una dimensión y deja el reporte en .ui-audit/ .security-audit/ .ux-audit/
  full [--tag t] [--offline] [--baseline <tag>]
                                    Las tres dimensiones + reporte consolidado .audit/<tag>/REPORT.md
  diff <dir-antes> <dir-después>    Resueltos / nuevos / persistentes
  auth <perfil>                     Guarda la sesión de una cuenta de PRUEBA (storageState en .auth/)
  branch                            Crea la rama de corrección audit/<fecha> (exige árbol limpio)
  guard --staged | --file <f>       Bloquea secretos, .env y edición de detectores (lo usa el pre-commit)
  install <claude|codex|cursor|generic|all> [--write]
                                    Configura el MCP, skills e instrucciones para cada cliente
  mcp                               Inicia el servidor MCP (stdio)

Exit code ≠ 0 si el estado no es "pass" (salvo --no-fail).`;

const argv = process.argv.slice(2);
const cmd = argv[0];
const flag = (n) => argv.includes(`--${n}`);
const opt = (n, d) => { const i = argv.indexOf(`--${n}`); return i >= 0 ? argv[i + 1] : d; };
const dir = path.resolve(opt('dir', '.'));
const pos = argv.slice(1).filter((a, i, all) => !a.startsWith('--') && !(i > 0 && /^--(tag|dir|baseline|file|config)$/.test(all[i - 1])));
const exitBy = (status) => { process.exitCode = status !== 'pass' && !flag('no-fail') ? 1 : 0; };
const line = (r) => `${r.status.toUpperCase()} · score ${r.score ?? '—'} · P0 ${r.counts.P0} P1 ${r.counts.P1} P2 ${r.counts.P2} P3 ${r.counts.P3}`;

try {
  switch (cmd) {
    case 'init': {
      const r = initProject(dir, { dryRun: !flag('write'), force: flag('force') });
      console.log(`Stack: ${JSON.stringify(r.stack)}\nRutas públicas: ${r.configs.ui.routes.join(', ')}\nRutas protegidas detectadas: ${r.routes.protectedPages.join(', ') || 'ninguna'}\nAPIs: ${r.routes.apis.join(', ') || 'ninguna'}\n`);
      for (const a of r.actions) console.log(`${r.dryRun ? '[plan]' : '[hecho]'} ${a.action.padEnd(12)} ${a.file}${a.reason ? ` — ${a.reason}` : ''}${a.lines ? ` (${a.lines.join(' ')})` : ''}`);
      console.log(`\n${r.dryRun ? 'Nada se escribió. Repetí con --write para aplicar.\n' : ''}Siguientes pasos:\n${r.next.map((n) => `- ${n}`).join('\n')}`);
      break;
    }
    case 'doctor': {
      const r = flag('security') ? doctorSecurity(dir) : doctorUi(dir);
      console.log(formatChecks(r));
      process.exitCode = r.ok ? 0 : 1;
      break;
    }
    case 'ui': case 'security': case 'ux': {
      const cfg = loadConfigs(dir);
      const tag = opt('tag', today());
      const common = { projectDir: dir, tag, offline: flag('offline') };
      let r;
      if (cmd === 'ui') r = await (await import('../scripts/audit/run-audit.mjs')).runUiAudit({ ...common, config: cfg.ui ?? {}, baseline: opt('baseline') && path.join('.ui-audit', opt('baseline')) });
      if (cmd === 'security') r = await (await import('../scripts/security/run-security.mjs')).runSecurity({ ...common, config: cfg.security ?? {}, zap: flag('zap'), baseline: opt('baseline') && path.join('.security-audit', opt('baseline')) });
      if (cmd === 'ux') {
        if (!cfg.journeys) throw new Error(`Falta ${CONFIG_FILES.journeys} (corré ui-audit init --write)`);
        r = await (await import('../scripts/ux/run-journeys.mjs')).runJourneys({ ...common, config: cfg.journeys, baseline: opt('baseline') && path.join('.ux-audit', opt('baseline')) });
      }
      console.log(`${line(r)} → ${path.relative(dir, path.join(r.outDir, cmd === 'ux' ? 'ux-report.md' : 'report.md'))}`);
      for (const t of summarize(r).top) console.log(`  ${t}`);
      exitBy(r.status);
      break;
    }
    case 'full': {
      const { runFull } = await import('../lib/full.mjs');
      const r = await runFull({ projectDir: dir, tag: opt('tag', today()), offline: flag('offline'), zap: flag('zap'), baseline: opt('baseline'), onProgress: (s, m) => console.error(`… ${m}`) });
      for (const d of r.dimensions) console.log(`${d.dimension.padEnd(9)} ${d.status.toUpperCase().padEnd(10)} P0 ${d.counts.P0} P1 ${d.counts.P1} P2 ${d.counts.P2} P3 ${d.counts.P3}`);
      console.log(`\n${r.status.toUpperCase()} → ${path.relative(dir, r.reportPath)}`);
      exitBy(r.status);
      break;
    }
    case 'diff': {
      const { diffReports } = await import('../scripts/audit/diff-report.mjs');
      const name = readJson(path.join(pos[1], 'report.json'), null) ? 'report' : 'ux-report';
      const r = diffReports(pos[0], pos[1], name);
      console.log(r.md);
      process.exitCode = r.regression ? 1 : 0;
      break;
    }
    case 'auth': {
      const { saveAuth } = await import('../scripts/ux/save-auth.mjs');
      const cfg = loadConfigs(dir);
      const r = await saveAuth({ projectDir: dir, config: cfg.journeys, personaId: pos[0] });
      console.log(`Sesión de prueba guardada en ${r.storageState}`);
      break;
    }
    case 'branch': {
      const r = createFixBranch(dir);
      console.log(r.created ? `Rama ${r.branch} creada desde ${r.from}` : `Ya estás en la rama de corrección ${r.branch}`);
      break;
    }
    case 'guard': {
      if (flag('staged')) {
        const v = checkStaged(dir);
        for (const x of v) console.error(`[ui-audit guard] ${x.file}:\n  ${x.reasons.join('\n  ')}`);
        process.exitCode = v.length ? 1 : 0;
      } else if (opt('file')) {
        const fs = await import('node:fs');
        const f = opt('file');
        const r = checkWrite({ file: f, content: fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : '' });
        console.log(r.allowed ? 'OK' : r.reasons.join('\n'));
        process.exitCode = r.allowed ? 0 : 1;
      } else throw new Error('guard requiere --staged o --file <archivo>');
      break;
    }
    case 'install': {
      const r = install(dir, pos[0] ?? 'all', { dryRun: !flag('write') });
      for (const a of r.actions) console.log(`${r.dryRun ? '[plan]' : '[hecho]'} ${a.action.padEnd(12)} ${a.file}${a.reason ? ` — ${a.reason}` : ''}`);
      console.log(`\nMCP: ${r.mcp.command} ${r.mcp.args.join(' ')}\n\n${r.notes.join('\n\n')}${r.dryRun ? '\n\nNada se escribió. Repetí con --write para aplicar.' : ''}`);
      break;
    }
    case 'mcp':
      await import('../mcp/server.mjs');
      break;
    case 'version': case '--version': case '-v':
      console.log(kitVersion());
      break;
    default:
      console.log(HELP);
      process.exitCode = cmd && !['help', '--help', '-h'].includes(cmd) ? 1 : 0;
  }
} catch (e) {
  console.error(`ui-audit: ${e.message}`);
  process.exitCode = 1;
}
