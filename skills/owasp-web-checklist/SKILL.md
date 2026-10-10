---
name: owasp-web-checklist
description: Checklist de revisión manual guiada de OWASP Top 10:2025 (más API Security 2023, LLM Top 10 2025 y Agentic Top 10 2026) para apps Next.js/Supabase. Usar durante una auditoría de seguridad para cubrir lo que los escáneres no ven.
---

# OWASP — qué revisar y cómo (complementa a los escáneres)

Para cada categoría: buscar con Grep/Read, citar archivo y línea, y marcar **hipótesis** si no hay evidencia.

| OWASP Top 10:2025 | Qué buscar en estas apps | Lo cubre el kit | Lo revisa una persona |
|---|---|---|---|
| A01 Broken Access Control | Rutas `/api` y Server Actions sin verificar usuario **y** dueño del recurso (IDOR/BOLA); rol solo chequeado en el cliente; `middleware` como única barrera; RLS ausente; redirecciones abiertas; CORS | `api-route-no-auth`, `server-action-no-auth`, `open-redirect`, matriz de acceso por perfil, advisors RLS | Reglas de negocio (¿un promotor puede ver datos de otro?) |
| A02 Security Misconfiguration | Headers, CSP, CORS, source maps, errores verbosos, buckets públicos, `.env` expuesto, previews sin protección | `headers-check`, `env-file`, `sourcemap-public` | Config de plataforma (Vercel/Supabase/N8N) |
| A03 Software Supply Chain Failures | Dependencias vulnerables, lockfile, typosquatting, `postinstall`, GitHub Actions sin pin, scripts de terceros sin SRI, plugins/MCP | osv-scanner, `third-party-script-no-sri`, skill `supply-chain-agents` | Decidir si una dependencia nueva se justifica |
| A04 Cryptographic Failures | Secretos en código/bundle, TLS desactivado, `Math.random` para tokens, datos sensibles sin cifrar, HTTP | `secret-*`, `tls-verify-off`, `weak-random`, `no-https-redirect` | Qué datos son sensibles y cómo se guardan |
| A05 Injection | SQL por concatenación, `eval`, shell con interpolación, XSS (`dangerouslySetInnerHTML`), filtros de Supabase armados con strings (`.or()` con input) | `sql-concat`, `shell-injection`, `eval-dynamic`, `dangerous-html`, Semgrep | Flujos donde entra texto libre |
| A06 Insecure Design | Falta de límites (intentos de login, reservas masivas, formularios), flujos de negocio abusables, sin modelo de amenazas | — | Sí: es de diseño; el agente propone, la persona decide |
| A07 Authentication Failures | Sesión en localStorage, `getSession` en servidor, sin rate limit, recuperación débil, cookies sin flags | `server-getsession`, `token-in-webstorage`, `cookie-*` | MFA, políticas de contraseña |
| A08 Software or Data Integrity Failures | Webhooks sin firma (Meta `X-Hub-Signature-256`, pagos), CI/CD sin pin, deserialización | `webhook-no-signature`, workflow con pin | Pipeline de despliegue |
| A09 Security Logging and Alerting Failures | Sin logs de login/denegaciones/cambios de rol; logs con datos sensibles; sin alertas | `log-sensitive` | Qué se registra y quién mira las alertas |
| A10 Mishandling of Exceptional Conditions | `catch` vacíos, errores que filtran stack, fallos que "abren" en vez de cerrar | `empty-catch`, `error-disclosure` | Que los fallos cierren (fail closed) |

## APIs (OWASP API Security 2023)
BOLA (API1), autenticación rota (API2), exposición de propiedades de más (API3: ¿la API devuelve columnas que el cliente no necesita, como el email de otros?), consumo sin límites (API4), BFLA (API5), flujos de negocio sin protección (API6), SSRF (API7: cualquier `fetch(urlDelUsuario)`), configuración (API8), inventario de endpoints (API9), consumo inseguro de APIs de terceros (API10).

## Si la app usa IA (OWASP LLM Top 10 2025)
Inyección de prompts (LLM01), divulgación de datos sensibles (LLM02), salida usada sin validar (LLM05: nunca ejecutar/renderizar sin sanear), agencia excesiva (LLM06: mínimo privilegio en herramientas), fuga del system prompt (LLM07), consumo sin límites (LLM10).

## Agentes y plugins (OWASP Top 10 for Agentic Applications 2026)
Secuestro de objetivo (ASI01), mal uso de herramientas (ASI02), abuso de identidad/privilegios (ASI03), cadena de suministro agéntica (ASI04), ejecución inesperada de código (ASI05), envenenamiento de memoria/contexto (ASI06). Ver skill `supply-chain-agents`.

## ASVS 5.0
Lista de verificación más profunda para login/sesión/autorización. Verificá niveles y capítulos vigentes en el repositorio de OWASP ASVS antes de citarlos en un reporte.
