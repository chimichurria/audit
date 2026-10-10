---
name: ux-flows-personas
description: Recorre y evalúa los flujos reales de cada perfil de usuario (visitante, cliente, promotor, admin, médico, paciente, operario…) en celular y escritorio, mide fricción, verifica que cada perfil vea solo lo suyo y propone mejoras de UX priorizadas con evidencia. Usar cuando se pida revisar el flujo UX/UI de todos los usuarios o perfiles de un proyecto.
---

# Flujos UX por perfil

Herramientas: MCP `audit_start {dimension:"ux"}` / CLI `npx -y @chimichurria/audit ux`. Config: `ui-audit.journeys.json`.

## 1. Definir perfiles y objetivos (con el usuario o desde el código)
Por proyecto: lista de perfiles, **un objetivo principal por perfil** y 2-3 flujos críticos. Rutas y roles salen del código (middleware, políticas RLS, menús); `audit_init` propone una base. Si un perfil necesita login, pedí una **cuenta de prueba** (variables `TEST_<PERFIL>_EMAIL/PASSWORD` en el entorno, nunca en el chat) y guardá la sesión con `audit_save_auth`. No uses datos reales. Los valores de formularios van como `{{TEST_*}}`.

## 2. Medir (hechos)
`audit_start {dimension:"ux", tag:"before"}`. Produce por perfil × dispositivo: flujo completo sí/no, interacciones, scrolls necesarios, tiempo, CLS, errores JS, 5xx, objetivos táctiles chicos, campos sin label o con teclado equivocado, falta de feedback tras enviar, y la **matriz de acceso** (cada perfil ve solo lo suyo; solo GET).

## 3. Interpretar (sugerencias; agente `ux-flow-analyst` en Claude Code)
Cada sugerencia cita **evidencia** (métrica, screenshot `end-*`/`fail-*`, hallazgo) y la heurística que la respalda. Sin evidencia se rotula **hipótesis a validar**. Marcos: 10 heurísticas de Nielsen, Fitts, Hick, Jakob, umbral de Doherty (< 400 ms), WCAG 2.2.
Escribí `.ux-audit/<tag>/UX-SUGGESTIONS.md` con `templates/ux-suggestions.md`: por perfil, objetivo, recorrido medido, fricciones, hasta 7 sugerencias con **impacto (A/M/B) × esfuerzo (S/M/L)**, cómo validarla (test con 5 personas, A/B, analítica) y conflictos entre perfiles.

## 4. Corregir (modo fix, dentro de `app-audit-full`)
`journey-failed` y `broken-access-control` son P0: se corrigen primero (control de acceso en servidor y RLS). Las fricciones de esfuerzo S (labels, `type="tel"`, feedback con `role="status"`, tamaños táctiles) se corrigen en la rama. Los cambios de flujo o de navegación quedan como sugerencias para que el usuario decida.

## 5. Qué NO hace
No decide estética ni marca. No reemplaza testear con usuarios reales ni con dispositivos reales.

## 6. Checklist por tipo de perfil
- **Anónimo/visitante**: propuesta de valor visible sin scroll, CTA principal a un toque, formulario mínimo, sin registro obligatorio antes de ver valor, errores claros.
- **Cliente/comprador**: precio y condiciones antes del compromiso, consulta recuperable, contacto (WhatsApp) con mensaje precargado, confirmación inequívoca.
- **Operativo (puerta, operario, planta)**: una mano, sol directo o poca luz (contraste alto), botones grandes, tolerancia a mala conexión (offline/reintento), acciones rápidas y reversibles.
- **Admin/gestión**: tablas con filtros y búsqueda, acciones masivas, confirmación en acciones destructivas, auditoría de cambios, exportar.
- **Profesional/paciente (salud)**: lenguaje apropiado por modo, bilingüe consistente, accesibilidad reforzada, claridad entre información general y consejo.
