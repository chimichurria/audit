---
name: ui-audit-loop
description: Mide y corrige la UI de una web en celular, tablet y escritorio — scroll horizontal, objetivos táctiles, accesibilidad WCAG 2.2 AA (axe-core), tipografía, zoom bloqueado, CLS, imágenes rotas, errores JS — con un loop medible por causa raíz. Usar cuando se pida revisar cómo se ve en el celular, responsive, mobile, accesibilidad o "que la UI no se rompa".
---

# UI audit loop (multi-dispositivo)

Modos: `fix` (por defecto, en rama), `audit` (no toca código), `verify` (re-medir).
Herramientas: MCP `audit_start {dimension:"ui"}` / CLI `npx -y @chimichurria/audit ui`.

## 0. Preflight
`audit_doctor`: navegadores de Playwright instalados (`npx playwright install chromium webkit`), `ui-audit.config.json` con `baseUrl` (dev server o preview), rutas y dispositivos. Si el dev server no está levantado, pedile al usuario que lo levante (o levantalo vos en segundo plano si es local) antes de medir. Sin navegador el reporte queda `incomplete`.

## 1. Baseline
`audit_start {dimension:"ui", tag:"before"}` → `audit_report {dimension:"ui", tag:"before"}`. Abrí los screenshots de `.ui-audit/before/*.png` para confirmar visualmente.

## 2. Triage por causa raíz
Un `width: 900px` en un contenedor puede generar overflow en 5 rutas × 3 dispositivos: es **una** causa. Para cada grupo: severidad, archivos (el escaneo estático da archivo:línea; el de navegador da el elemento), fix mínimo.

## 3. Fix (rama `audit/<fecha>`, un commit por causa)
Permitido: CSS/clases responsive (`max-width`, `flex-wrap`, `min-width:0`, `dvh`), tamaños táctiles (min 44px), labels y `alt`, contraste, `:focus-visible`, `width/height` en imágenes, quitar `user-scalable=no`.
Prohibido: ocultar contenido para que no desborde (`overflow-x:hidden` en `body` como parche), borrar funcionalidades, rediseñar la marca, editar detectores/umbrales (`scripts/audit/*`, bloqueado por hook), `ui-audit-ignore` sin motivo.

## 4. Re-medir y verificar
`audit_start {dimension:"ui", tag:"after", baseline:"before"}` y `audit_diff`. Ningún P0/P1 nuevo. Agente `ui-verifier` (o prompt `verify`).

## 5. Topes
Máx. 5 iteraciones; parar si 2 seguidas no mejoran; consultar si el fix exige rediseño de layout o más de 8 archivos.

Severidad: **P0** la página no carga, error 5xx, axe critical (ej. imagen funcional sin alt). **P1** overflow horizontal en celular, objetivo táctil < 24px, zoom bloqueado, error JS, axe serious (contraste, labels). **P2** objetivos < 44px, texto < 12px, CLS > 0.1, `100vh`. **P3** menores.
