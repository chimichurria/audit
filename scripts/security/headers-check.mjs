#!/usr/bin/env node
// Revisión pasiva (solo GET/HEAD, una vez por ruta) del sitio desplegado. No es fuzzing ni explotación.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { findSecrets, redact } from './security-scan.mjs';

export const F = (id, severity, owasp, title, where, fix, evidence = '') => ({ source: 'headers-check', id, severity, owasp, title, where, fix, evidence });

export function hostAllowed(host, allowed) {
  return allowed.some((p) => new RegExp(`^${p.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[a-z0-9-]*')}$`, 'i').test(host));
}

export async function checkHeaders({ baseUrl, routes = ['/'], allowedHosts = [], timeoutMs = 15000, maxScripts = 20, sensitivePaths = ['/.env', '/.git/HEAD'] }) {
  const base = new URL(baseUrl);
  if (!hostAllowed(base.host, allowedHosts) && !hostAllowed(base.hostname, allowedHosts)) {
    throw new Error(`Host no permitido: ${base.host}. Agregalo a allowedHosts solo si es tuyo o tenés autorización escrita.`);
  }
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const hdrs = { 'user-agent': 'ui-audit-security/0.2 (auditoria propia)', ...(bypass ? { 'x-vercel-protection-bypass': bypass } : {}) };
  const get = (u, extra = {}, method = 'GET') => fetch(u, { method, redirect: 'manual', headers: { ...hdrs, ...extra }, signal: AbortSignal.timeout(timeoutMs) });
  const out = [];
  const https = base.protocol === 'https:';

  for (const route of routes) {
    const url = new URL(route, base).href;
    const res = await get(url);
    const h = (n) => res.headers.get(n);
    const where = url;
    const csp = h('content-security-policy');
    if (https && !h('strict-transport-security')) out.push(F('hsts-missing', 'P2', ['A02:2025'], 'Falta Strict-Transport-Security', where, 'Agregar HSTS (max-age >= 31536000) en el host de producción.'));
    if (!csp && !h('content-security-policy-report-only')) out.push(F('csp-missing', 'P2', ['A02:2025', 'A05:2025'], 'Sin Content-Security-Policy', where, 'Empezar con Report-Only y endurecer; en Next usar nonces.'));
    if (csp && /script-src[^;]*'unsafe-eval'/.test(csp)) out.push(F('csp-unsafe-eval', 'P3', ['A02:2025'], "CSP permite 'unsafe-eval'", where, 'Quitarlo salvo que una librería lo exija.'));
    if (!/nosniff/i.test(h('x-content-type-options') ?? '')) out.push(F('nosniff-missing', 'P2', ['A02:2025'], 'Falta X-Content-Type-Options: nosniff', where, 'Agregar el header.'));
    if (!h('x-frame-options') && !/frame-ancestors/.test(csp ?? '')) out.push(F('clickjacking', 'P2', ['A02:2025'], 'Sin protección anti-iframe (X-Frame-Options / frame-ancestors)', where, "CSP frame-ancestors 'self' o X-Frame-Options: SAMEORIGIN."));
    if (!h('referrer-policy')) out.push(F('referrer-policy-missing', 'P3', ['A02:2025'], 'Falta Referrer-Policy', where, 'strict-origin-when-cross-origin.'));
    if (!h('permissions-policy')) out.push(F('permissions-policy-missing', 'P3', ['A02:2025'], 'Falta Permissions-Policy', where, 'Deshabilitar cámara/micrófono/geolocalización si no se usan.'));
    if (h('x-powered-by')) out.push(F('x-powered-by', 'P3', ['A02:2025'], `Header x-powered-by expuesto (${h('x-powered-by')})`, where, 'En Next: poweredByHeader: false.'));

    const cookies = res.headers.getSetCookie?.() ?? [];
    for (const c of cookies) {
      const name = c.split('=')[0];
      const sess = /sess|token|auth|sb-|jwt/i.test(name);
      if (https && !/;\s*secure/i.test(c)) out.push(F('cookie-no-secure', 'P2', ['A07:2025'], `Cookie ${name} sin Secure`, where, 'Agregar Secure.'));
      if (sess && !/;\s*httponly/i.test(c)) out.push(F('cookie-no-httponly', 'P3', ['A07:2025'], `Cookie de sesión ${name} sin HttpOnly`, where, 'Activar HttpOnly salvo que el cliente la necesite (las cookies de @supabase/ssr se leen desde JS por diseño).'));
      if (!/;\s*samesite/i.test(c)) out.push(F('cookie-no-samesite', 'P3', ['A01:2025'], `Cookie ${name} sin SameSite`, where, 'SameSite=Lax (o Strict).'));
    }

    const ev = await get(url, { origin: 'https://evil.example' });
    const acao = ev.headers.get('access-control-allow-origin');
    const cred = /true/i.test(ev.headers.get('access-control-allow-credentials') ?? '');
    if (cred && (acao === '*' || acao === 'https://evil.example')) out.push(F('cors-credentials-open', 'P1', ['A01:2025', 'A02:2025'], 'CORS con credenciales para cualquier origen', where, 'Allowlist de orígenes propios; nunca reflejar Origin con credenciales.', `ACAO=${acao}`));
  }

  if (https) {
    try {
      const r = await get(`http://${base.host}/`);
      const loc = r.headers.get('location') ?? '';
      if (!(r.status >= 300 && r.status < 400 && loc.startsWith('https://'))) out.push(F('no-https-redirect', 'P2', ['A04:2025'], 'HTTP no redirige a HTTPS', `http://${base.host}/`, 'Forzar redirección a HTTPS.'));
    } catch { /* puerto 80 cerrado: aceptable */ }
  }

  for (const p of sensitivePaths) {
    const r = await get(new URL(p, base).href);
    if (r.status !== 200) continue;
    const body = (await r.text()).slice(0, 400);
    if ((p.endsWith('.env') && /^[A-Z][A-Z0-9_]{2,}=.+/m.test(body)) || (p.includes('.git') && /^ref: refs\//.test(body))) {
      out.push(F('sensitive-file-exposed', 'P0', ['A02:2025'], `Archivo sensible público: ${p}`, new URL(p, base).href, 'Bloquear el acceso, rotar todo lo expuesto y revisar el despliegue.'));
    }
  }

  const probe = await get(new URL('/api/__audit_probe__', base).href);
  const probeBody = (await probe.text()).slice(0, 4000);
  if (/\bat\s+\S+\s+\(.*:\d+:\d+\)|node_modules|ECONNREFUSED|SQLSTATE|Traceback \(most recent/.test(probeBody)) {
    out.push(F('error-disclosure', 'P2', ['A02:2025', 'A10:2025'], 'Errores con detalles internos (stack, rutas, SQL)', new URL('/api/__audit_probe__', base).href, 'Respuestas de error genéricas; el detalle va al log del servidor.'));
  }

  const html = await (await get(new URL(routes[0] ?? '/', base).href)).text();
  const srcs = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/gi)].slice(0, maxScripts);
  const third = new Set();
  for (const m of srcs) {
    const u = new URL(m[1], base);
    if (u.host !== base.host) {
      third.add(u.host);
      if (!/\bintegrity=/i.test(m[0])) out.push(F('third-party-script-no-sri', 'P3', ['A03:2025', 'A08:2025'], `Script de terceros sin SRI: ${u.host}`, u.href, 'Agregar integrity+crossorigin si el recurso es estático, o autoalojarlo. Revisar qué datos recibe.'));
      continue;
    }
    const js = await (await get(u.href)).text();
    for (const s of findSecrets(js)) out.push(F('secret-in-bundle', 'P0', ['A02:2025', 'A04:2025'], `${s.label} en el bundle público`, u.href, 'Rotar la credencial y sacarla del cliente.', redact(s.value)));
    const map = await get(`${u.href}.map`, {}, 'HEAD');
    if (map.status === 200 && /json|octet/i.test(map.headers.get('content-type') ?? '')) out.push(F('sourcemap-public', 'P2', ['A02:2025'], 'Source map público', `${u.href}.map`, 'No publicar source maps en producción (o subirlos solo a tu herramienta de errores).'));
  }
  return { findings: out, thirdPartyHosts: [...third] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const cfgPath = process.argv.find((a) => a.endsWith('.json')) ?? 'ui-audit.security.json';
  const cfg = fs.existsSync(cfgPath) ? JSON.parse(fs.readFileSync(cfgPath, 'utf8')) : {};
  const baseUrl = process.argv.find((a) => /^https?:\/\//.test(a)) ?? process.env.AUDIT_BASE_URL ?? cfg.baseUrl;
  const { findings, thirdPartyHosts } = await checkHeaders({ ...cfg, baseUrl, allowedHosts: cfg.allowedHosts ?? ['localhost', '127.0.0.1'] });
  for (const f of findings) console.log(`[${f.severity}] ${f.id} (${f.owasp.join(',')}) ${f.title} -> ${f.where}${f.evidence ? ` [${f.evidence}]` : ''}`);
  console.log(`\nTerceros: ${thirdPartyHosts.join(', ') || 'ninguno'}`);
  process.exit(findings.some((f) => ['P0', 'P1'].includes(f.severity)) ? 1 : 0);
}
