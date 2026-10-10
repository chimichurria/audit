---
name: security-audit-loop
description: Audita y endurece la seguridad de una app web (Next.js/Vercel/Supabase/N8N) con un loop medible — secretos, dependencias, OWASP Top 10:2025, headers, control de acceso, integraciones y plugins — y corrige lo seguro en una rama. Usar cuando se pida revisar seguridad, hardening, OWASP, vulnerabilidades, "que no me hackeen", o antes de salir a producción.
---

# Security audit loop

Modos: `fix` (por defecto: loop con rama `audit/<fecha>`), `audit` (no toca código), `verify` (re-medir).
Herramientas: MCP `audit_start {dimension:"security"}` / CLI `npx -y @chimichurria/audit security`.

## 0. Preflight (obligatorio)
1. Reglas de oro de `app-audit-full`. Confirmá alcance: ¿proyecto propio o autorización escrita? Si `policy.offlineOnly` está activo (clientes corporativos), solo análisis local, y aun así consultalo.
2. `audit_doctor`: gitleaks y osv-scanner son requeridas; sin ellas el reporte queda `incomplete` y **no aprueba**.
3. `ui-audit.security.json` con `allowedHosts` propios (nunca `*.vercel.app`) y `.security-audit/` en `.gitignore`.
4. Objetivo: preview de Vercel o local. Producción (`policy.productionHosts`) = solo lectura.

## 1. Baseline
`audit_start {dimension:"security", tag:"before"}` → `audit_report {dimension:"security", tag:"before"}`. Si el estado es `incomplete`, decí qué herramienta falta; no declares "limpio".
Complementá con lo que ningún script ve: skills `owasp-web-checklist`, `supabase-rls-audit`, `vercel-nextjs-hardening`, `integrations-webhooks`, `supply-chain-agents`.

## 2. Triage por causa raíz y riesgo real
Agrupá por causa. Para cada grupo: OWASP, severidad máxima, **alcanzabilidad**, archivos, fix. Una CVE en una dependencia de desarrollo no alcanzable no es P0.
**Secretos reales** (gitleaks, `secret-in-bundle`, `secret-*`): no los arregles solo. Pará, avisá con el nombre del servicio (nunca el valor) y pedí rotar y purgar el historial.

## 3. Fix (modo fix)
Agente `security-fixer` (o vos mismo en otros clientes), rama vía `audit_fix_branch`, un commit por causa raíz con el id del hallazgo (`audit_fix_commit`).
Permitido: helpers de auth/validación (`requireUser`, `requireRole`, zod), headers en `next.config`, bump patch/minor de dependencias con tests, migraciones SQL **como archivos** (no se aplican), `.env.example`.
Prohibido: aflojar CSP/CORS/RLS, borrar tests, ignores sin motivo, tocar detectores/umbrales, aplicar migraciones o cambiar variables en Vercel/Supabase.

## 4. Re-barrido
`audit_start {dimension:"full", tag:"after", baseline:"before"}`: una corrección de seguridad no puede romper la UI ni los flujos (CSP que bloquea fuentes, cookies que cortan sesiones).

## 5. Verificación con contexto fresco
Agente `security-verifier` (o prompt `verify`) con el diff, reportes antes/después y la lista de `security-audit-ignore` nuevos. Rechaza si un fix aflojó una defensa o no responde a un hallazgo.

## 6. Topes
Máx. 5 iteraciones; parar si 2 seguidas no reducen P0/P1; parar y consultar si el fix exige rediseño de auth, migración de datos o más de 8 archivos.

## 7. Reporte
Estado, score, tabla por OWASP, resueltos/pendientes/nuevos, **qué NO se verificó** y acciones humanas (rotar claves, aplicar migraciones, activar protecciones en Vercel).

Severidad: **P0** explotable ya con impacto alto (secreto vivo, tabla con datos sin RLS, admin abierto, `.env` público). **P1** alto y probable (inyección, CORS con credenciales reflejado, cookie de sesión insegura, dependencia crítica). **P2** endurecimiento faltante (CSP, headers, validación). **P3** informativo.
