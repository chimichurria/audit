// Instala los adaptadores por cliente en un proyecto: MCP + skills + instrucciones.
// Una sola fuente (skills/, adapters/) → Claude Code, Codex, Cursor y cualquier cliente MCP.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const KIT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const START = '<!-- ui-audit:start -->';
const END = '<!-- ui-audit:end -->';

export function kitVersion() { return JSON.parse(fs.readFileSync(path.join(KIT_ROOT, 'package.json'), 'utf8')).version; }

// Antes de publicar en npm (o en desarrollo) se usa la ruta local; instalado vía npx, el paquete publicado.
export function mcpCommand() {
  const server = path.join(KIT_ROOT, 'mcp', 'server.mjs');
  if (/[\\/]_npx[\\/]|[\\/]node_modules[\\/]@chimichurria[\\/]audit[\\/]/.test(server) || process.env.UI_AUDIT_USE_NPX === '1') return { command: 'npx', args: ['-y', `@chimichurria/audit@${kitVersion()}`, 'mcp'] };
  return { command: 'node', args: [server] };
}

const SERVER_NAME = 'ui-audit';
const mcpJson = () => ({ [SERVER_NAME]: { ...mcpCommand(), env: {} } });

function mergeJson(file, mutate, dryRun, actions) {
  const exists = fs.existsSync(file);
  const data = exists ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  mutate(data);
  actions.push({ file, action: exists ? 'merge' : 'create' });
  if (!dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); }
}

function upsertBlock(file, block, dryRun, actions) {
  const exists = fs.existsSync(file);
  const text = exists ? fs.readFileSync(file, 'utf8') : '';
  const wrapped = `${START}\n${block.trim()}\n${END}`;
  const next = text.includes(START) ? text.replace(new RegExp(`${START}[\\s\\S]*?${END}`), wrapped) : `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${wrapped}\n`;
  actions.push({ file, action: text.includes(START) ? 'update-block' : exists ? 'append-block' : 'create' });
  if (!dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, next); }
}

function copySkills(dest, dryRun, actions) {
  for (const name of fs.readdirSync(path.join(KIT_ROOT, 'skills'))) {
    const src = path.join(KIT_ROOT, 'skills', name, 'SKILL.md');
    if (!fs.existsSync(src)) continue;
    const to = path.join(dest, name, 'SKILL.md');
    actions.push({ file: to, action: fs.existsSync(to) ? 'overwrite' : 'create' });
    if (!dryRun) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.copyFileSync(src, to); }
  }
}

const tomlString = (s) => JSON.stringify(s);

export function install(projectDir, client, { dryRun = true } = {}) {
  const actions = [];
  const notes = [];
  const cmd = mcpCommand();
  const agentsBlock = fs.readFileSync(path.join(KIT_ROOT, 'adapters', 'generic', 'AGENTS.block.md'), 'utf8');
  const clients = client === 'all' ? ['claude', 'codex', 'cursor'] : [client];

  for (const c of clients) {
    if (c === 'claude') {
      notes.push('Claude Code (recomendado, trae skills + agentes + comandos + hooks + MCP):\n  /plugin marketplace add chimichurria/audit\n  /plugin install ui-audit@chimichurria\nSin plugin, este install deja el MCP en .mcp.json del proyecto.');
      mergeJson(path.join(projectDir, '.mcp.json'), (d) => { d.mcpServers = { ...(d.mcpServers ?? {}), ...mcpJson() }; }, dryRun, actions);
    } else if (c === 'codex') {
      const file = path.join(projectDir, '.codex', 'config.toml');
      const block = [`[mcp_servers.${SERVER_NAME}]`, `command = ${tomlString(cmd.command)}`, `args = [${cmd.args.map(tomlString).join(', ')}]`, 'startup_timeout_sec = 30', 'tool_timeout_sec = 120', `env_vars = ["VERCEL_AUTOMATION_BYPASS_SECRET", "AUDIT_BASE_URL"]`].join('\n');
      const text = fs.existsSync(file) ? fs.readFileSync(file, 'utf8') : '';
      if (text.includes(`[mcp_servers.${SERVER_NAME}]`)) actions.push({ file, action: 'keep', reason: 'ya configurado' });
      else {
        actions.push({ file, action: text ? 'append' : 'create' });
        if (!dryRun) { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, `${text}${text && !text.endsWith('\n') ? '\n' : ''}${text ? '\n' : ''}${block}\n`); }
      }
      copySkills(path.join(projectDir, '.agents', 'skills'), dryRun, actions);
      upsertBlock(path.join(projectDir, 'AGENTS.md'), agentsBlock, dryRun, actions);
      notes.push(`Codex: .codex/config.toml del proyecto solo se lee si el proyecto es "trusted". Alternativa global:\n  codex mcp add ${SERVER_NAME} -- ${cmd.command} ${cmd.args.join(' ')}\n  y en ~/.codex/config.toml: tool_timeout_sec = 120 dentro de [mcp_servers.${SERVER_NAME}].`);
    } else if (c === 'cursor') {
      mergeJson(path.join(projectDir, '.cursor', 'mcp.json'), (d) => { d.mcpServers = { ...(d.mcpServers ?? {}), ...mcpJson() }; }, dryRun, actions);
      copySkills(path.join(projectDir, '.agents', 'skills'), dryRun, actions);
      const rule = fs.readFileSync(path.join(KIT_ROOT, 'adapters', 'cursor', 'ui-audit.mdc'), 'utf8');
      const to = path.join(projectDir, '.cursor', 'rules', 'ui-audit.mdc');
      actions.push({ file: to, action: fs.existsSync(to) ? 'overwrite' : 'create' });
      if (!dryRun) { fs.mkdirSync(path.dirname(to), { recursive: true }); fs.writeFileSync(to, rule); }
      upsertBlock(path.join(projectDir, 'AGENTS.md'), agentsBlock, dryRun, actions);
      notes.push('Cursor: habilitá el servidor "ui-audit" en Settings → MCP la primera vez.');
    } else if (c === 'generic') {
      upsertBlock(path.join(projectDir, 'AGENTS.md'), agentsBlock, dryRun, actions);
      notes.push(`Cualquier cliente MCP (Windsurf, VS Code/Copilot, Zed, Claude Desktop): agregá en su config\n${JSON.stringify({ mcpServers: mcpJson() }, null, 2)}`);
    } else throw new Error(`Cliente desconocido: ${c} (claude | codex | cursor | generic | all)`);
  }
  return { dryRun, client, mcp: cmd, actions: actions.map((a) => ({ ...a, file: path.relative(projectDir, a.file) || a.file })), notes };
}
