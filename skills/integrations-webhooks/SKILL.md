---
name: integrations-webhooks
description: Seguridad de integraciones de terceros, webhooks y automatizaciones (Meta/Instagram, ticketeras, pagos, WhatsApp, N8N, Resend, APIs de logística). Usar al auditar endpoints que reciben o envían datos a otros servicios.
---

# Integraciones y webhooks

- **Webhooks entrantes**: verificar firma/HMAC con comparación de tiempo constante (`crypto.timingSafeEqual`) sobre el **cuerpo crudo**; rechazar si falta. Meta usa `X-Hub-Signature-256` con el app secret y un `verify_token` en el handshake GET; para otros proveedores, buscá su método en su documentación. Protección contra repetición (timestamp/ID de evento) y respuesta rápida (procesar en segundo plano).
- **Secretos de terceros** (tokens de Meta, API keys de logística, SMTP): solo en variables de entorno del servidor, rotables, con el mínimo de scopes. Nunca en el bundle (`headers-check` lo revisa) ni en logs.
- **N8N**: webhooks con autenticación (Header Auth/Basic) o URL no adivinable más firma; editor no expuesto a Internet (o detrás de SSO/VPN); `N8N_ENCRYPTION_KEY` fijada y resguardada; versión actualizada; credenciales en el gestor de N8N, no en nodos Function/Code; allowlist de IP cuando el proveedor lo permite.
- **Salientes**: nunca `fetch` a una URL controlada por el usuario sin allowlist (SSRF); timeouts; no registrar tokens.
- **Datos personales a terceros**: listar qué datos van a cada servicio (nombre, WhatsApp, fecha de nacimiento…); minimizar; confirmar contrato/consentimiento si aplica (en Argentina, Ley 25.326: revisalo con un asesor legal, el kit no lo certifica).
- **Scripts de terceros en el front** (analytics, píxeles, chat, mapas): inventario, SRI si es estático, CSP que los limite, y verificar que no reciban datos de formularios.
- **Plataformas**: las apps de Meta con permisos avanzados requieren App Review (no es seguridad, pero bloquea el despliegue). Nunca guardar contraseñas de redes de clientes en el repo.
