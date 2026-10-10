// Política aplicada por código: hosts permitidos, modo offline forzado, hosts de producción en solo lectura.
// Toda corrida del CLI y toda herramienta MCP pasan por acá; no hay forma de saltearla desde el MCP.
import fs from 'node:fs';
import path from 'node:path';
import { hostAllowed } from '../scripts/security/headers-check.mjs';

const PUBLIC_WILDCARD = /^\*\.(?:vercel\.app|netlify\.app|github\.io|pages\.dev|herokuapp\.com|onrender\.com|fly\.dev|web\.app|firebaseapp\.com|azurewebsites\.net|cloudfront\.net|ngrok(?:-free)?\.app|trycloudflare\.com)$/i;

export const DEFAULT_POLICY = { offlineOnly: false, fixAllowed: true, productionHosts: [] };

export function validateAllowedHosts(hosts = []) {
  const errors = [];
  if (!hosts.length) errors.push('allowedHosts vacío');
  for (const h of hosts) {
    if (h === '*' || /^\*\.[^.]+$/.test(h)) errors.push(`allowedHosts con comodín total: ${h}`);
    else if (PUBLIC_WILDCARD.test(h)) errors.push(`allowedHosts con comodín público (${h}): usá un prefijo propio, ej. mi-proyecto-*.vercel.app`);
  }
  return errors;
}

// Fuente única: ui-audit.security.json. Si no existe, se usan los hosts de la config de la dimensión (o solo localhost).
export function loadPolicy(projectDir = '.', fallbackHosts) {
  const file = path.join(projectDir, 'ui-audit.security.json');
  const cfg = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : {};
  return {
    ...DEFAULT_POLICY,
    ...(cfg.policy ?? {}),
    allowedHosts: cfg.allowedHosts ?? fallbackHosts ?? ['localhost', '127.0.0.1'],
    configFound: fs.existsSync(file)
  };
}

export function isHostAllowed(url, policy) {
  const u = new URL(url);
  const valid = policy.allowedHosts.filter((h) => !validateAllowedHosts([h]).length);
  return hostAllowed(u.host, valid) || hostAllowed(u.hostname, valid);
}

export function isProductionHost(url, policy) {
  if (!url) return false;
  const u = new URL(url);
  return hostAllowed(u.host, policy.productionHosts ?? []) || hostAllowed(u.hostname, policy.productionHosts ?? []);
}

export function assertHostAllowed(url, policy) {
  if (!isHostAllowed(url, policy)) {
    throw new Error(`Host no permitido: ${new URL(url).host}. Agregalo a allowedHosts de ui-audit.security.json solo si es tuyo o tenés autorización escrita.`);
  }
}

// Ajusta lo pedido a lo que la política permite. Devuelve opciones efectivas + motivos (para el reporte).
export function enforce(requested, policy) {
  const out = { ...requested, reasons: [] };
  if (policy.offlineOnly) {
    if (!requested.offline) out.reasons.push('policy.offlineOnly: se fuerza --offline (sin red, sin osv/semgrep/ZAP, sin navegador contra URLs).');
    out.offline = true;
    out.zap = false;
    out.network = false;
  } else out.network = !requested.offline;
  if (requested.baseUrl && out.network) {
    assertHostAllowed(requested.baseUrl, policy);
    if (isProductionHost(requested.baseUrl, policy)) {
      out.readOnly = true;
      if (requested.zap) out.reasons.push('Host de producción: ZAP deshabilitado.');
      out.zap = false;
      out.reasons.push('Host de producción: solo lectura, sin correcciones automáticas.');
    }
  }
  out.fixAllowed = policy.fixAllowed !== false && !out.readOnly;
  if (!out.fixAllowed && requested.fix) out.reasons.push('Correcciones deshabilitadas por política: modo audit-only.');
  return out;
}
