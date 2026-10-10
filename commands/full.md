---
description: Auditoría completa (UI + seguridad + flujos por perfil) que corrige lo seguro en una rama y deja reporte consolidado con backlog
argument-hint: [fix|audit] [--offline] [url-base]
---
Activá la skill `app-audit-full`. Modo por defecto: **fix** (corrige en la rama `audit/<fecha>`; nunca push, deploy ni migraciones aplicadas). Con `audit` no se toca código. Usá las herramientas MCP `audit_*` del servidor ui-audit. Argumentos: $ARGUMENTS
