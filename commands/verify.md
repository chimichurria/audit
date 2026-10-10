---
description: Re-mide las tres dimensiones contra la línea base y verifica la rama de corrección con contexto fresco
argument-hint: [tag-baseline]
---
Corré `audit_start {dimension:"full", tag:"verify", baseline:"$ARGUMENTS"}` (baseline por defecto: `before`), esperá con `audit_status` y después activá la skill `audit-verify` (agentes `security-verifier` y `ui-verifier`). Informá APROBADO/RECHAZADO con motivos.
