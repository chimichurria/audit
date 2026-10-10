---
name: audit-verify
description: Verificación con contexto fresco de una rama de corrección de auditoría (ui-audit) — revisa el diff y los reportes antes/después y responde APROBADO o RECHAZADO con motivos. Usar al terminar de corregir hallazgos de UI, seguridad o flujos, antes del reporte final.
---

# Verificación (contexto fresco)

No escribiste este código. Buscá lo que el autor no vio. **No edites nada.**

Insumos: `git diff <rama-base>...HEAD` y `git log` de la rama `audit/*`; reportes antes/después (`audit_report` por dimensión y tag, `audit_diff`); `git diff <rama-base>...HEAD | grep -E "(ui|security)-audit-ignore"`.

Verificá:
1. Cada commit responde a un hallazgo citado; marcá lo que no.
2. Ninguna defensa se aflojó: CSP, CORS, RLS, validaciones, flags de cookies, `overflow-x:hidden` en body como parche, contenido ocultado para "pasar" la medición.
3. No hay secretos en el diff, fixtures ni reportes. No se escribieron `.env`. No se editaron detectores ni umbrales del kit.
4. No aparecieron P0/P1 nuevos en **ninguna** dimensión y los resueltos realmente desaparecieron (no solo cambiaron de nombre o de ruta).
5. Los fixes fallan cerrado (si falla el chequeo de permisos, se deniega).
6. Todo `*-audit-ignore` nuevo tiene un motivo verdadero.
7. Tests del proyecto en verde si existen (`npm test`).

Respuesta: **APROBADO** o **RECHAZADO** + lista numerada de motivos con archivo y línea.
