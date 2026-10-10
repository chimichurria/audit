---
name: vercel-nextjs-hardening
description: Endurecimiento de proyectos Next.js desplegados en Vercel — headers, CSP, variables de entorno, protección de previews, Server Actions, middleware y WAF. Usar en auditorías de seguridad de apps en Vercel.
---

# Vercel + Next.js — hardening

## Revisión de código (la hace el agente)
- **Secretos**: ningún secreto con prefijo `NEXT_PUBLIC_`. Las variables sensibles solo en servidor. `.env.example` sin valores.
- **Server Actions y Route Handlers son endpoints públicos**: cada uno autentica, autoriza (dueño del recurso) y valida entrada (zod u otro) aunque la UI "no muestre" el botón.
- **Middleware no es la única barrera**: hubo un bypass de autorización en middleware de Next.js (CVE-2025-29927, vía header `x-middleware-subrequest`). La verificación real va también en cada ruta/acción y en RLS. Mantener Next.js parcheado (osv-scanner lo detecta; confirmá la versión corregida en el aviso oficial).
- **`next.config`**: `poweredByHeader: false`; `productionBrowserSourceMaps: false`; headers de seguridad:

```js
// next.config.mjs (base; ajustar CSP a lo que la app realmente carga)
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
  { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains' }
];
export default {
  poweredByHeader: false,
  async headers() { return [{ source: '/:path*', headers: securityHeaders }]; }
};
```
- **CSP**: arrancar en `Content-Security-Policy-Report-Only`, listar los orígenes reales (Supabase, fuentes, analytics, mapas, Meta) y pasar a enforcing con nonces. Después, **re-medir UI y flujos**: una CSP mal puesta rompe fuentes, imágenes y galerías.
- **Imágenes**: `images.remotePatterns` acotado (no `**`).
- **Redirecciones/rewrites** sin destino controlado por el usuario.

## Revisión de plataforma (la hace una persona; el agente entrega la lista)
- Deployment Protection activada en previews (Vercel Authentication o bypass con secreto); el secreto de bypass solo en CI y en el entorno del servidor MCP.
- Variables de entorno separadas por entorno (Production/Preview/Development) y las sensibles marcadas como tales.
- Vercel Firewall/WAF: rate limit para `/login`, formularios de reserva/registro y webhooks; modo de desafío ante ataque.
- Dominios: HTTPS forzado, sin subdominios colgados.
- Equipo: 2FA para todos, mínimos privilegios, tokens de Vercel rotados.
- Verificá cada nombre de ajuste en la documentación vigente de Vercel: cambian de lugar.
