# AGENTS.md — desarrollo del kit ui-audit

Este repositorio es el kit (CLI + servidor MCP + plugin de Claude Code). Para **usar** el kit en otro proyecto, ver `README.md` (`ui-audit install <cliente>` inyecta en ese proyecto el bloque de `adapters/generic/AGENTS.block.md`).

## Estructura
- `scripts/audit|security|ux/` — detectores y runners (fuente de verdad; los nombres los fija la especificación).
- `lib/` — política, guard, git, jobs, init, install, orquestación `full`, utilidades.
- `cli/ui-audit.mjs` y `mcp/server.mjs` — dos frentes sobre las mismas funciones.
- `skills/` — única fuente de los SKILL.md (Claude Code, Codex vía `.agents/skills`, Cursor, prompts MCP).
- `agents/`, `commands/`, `hooks/`, `.claude-plugin/` — plugin de Claude Code.
- `fixtures/` + `tests/` — aceptación (`broken` debe fallar, `ok` debe quedar sin P0/P1).

## Reglas
- `npm test` en verde antes de cualquier commit. No se avanza en rojo.
- Detectores y umbrales no se editan para que un proyecto "pase". Mantenimiento legítimo del kit: `UIAUDIT_ALLOW_DETECTOR_EDIT=1` / `SECAUDIT_ALLOW_DETECTOR_EDIT=1`, justificado en el commit.
- Nunca secretos reales en fixtures: se arman en runtime (`'AKIA' + '…'`).
- Nada de nombres de clientes ni datos personales en el repo (es público).
- Si un contrato externo (flags de gitleaks/osv/semgrep, hooks, Playwright, clientes MCP) cambia, manda la documentación vigente: ajustá y anotalo en el README.
