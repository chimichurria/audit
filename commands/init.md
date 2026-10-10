---
description: Prepara el proyecto para auditar (configs de UI, seguridad y flujos por perfil, .gitignore y guard pre-commit)
argument-hint: [--force]
---
Usá la herramienta MCP `audit_init` primero con `write: false` y mostrá el plan: stack detectado, rutas públicas, rutas protegidas y APIs. Completá con lo que leas en el código (middleware, políticas RLS, menús): `baseUrl` (dev server o preview de Vercel), `allowedHosts` (solo hosts propios, nunca `*.vercel.app`), perfiles, flujos reales con selectores y `accessChecks`. Con el OK del usuario, ejecutá `audit_init` con `write: true` y ajustá los JSON generados. Si el proyecto es de un cliente con restricciones de seguridad, poné `policy.offlineOnly: true`. Terminá con `audit_doctor` y mostrá el resultado. Argumentos: $ARGUMENTS
