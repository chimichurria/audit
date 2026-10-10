// Dispositivos y contexto de navegador compartidos por la auditoría de UI y los flujos por perfil.
import { chromium, webkit, firefox, devices } from 'playwright';

export const BROWSERS = { chromium, webkit, firefox };

// Acepta nombres de Playwright ("iPhone 13") y la forma "Desktop Chrome 1440" (ancho explícito).
export function resolveDevice(name) {
  if (devices[name]) return { opts: { ...devices[name] }, browserType: devices[name].defaultBrowserType ?? 'chromium', isMobile: !!devices[name].isMobile };
  const m = /^(Desktop (?:Chrome|Firefox|Safari|Edge))\s+(\d{3,4})(?:x(\d{3,4}))?$/i.exec(name);
  const baseName = m ? Object.keys(devices).find((k) => k.toLowerCase() === m[1].toLowerCase()) : null;
  if (baseName) {
    const width = Number(m[2]);
    const height = Number(m[3] ?? Math.round(width * 0.625));
    return { opts: { ...devices[baseName], viewport: { width, height } }, browserType: devices[baseName].defaultBrowserType ?? 'chromium', isMobile: false };
  }
  if (/desktop/i.test(name)) return { opts: { viewport: { width: 1440, height: 900 } }, browserType: 'chromium', isMobile: false };
  throw new Error(`Dispositivo desconocido: ${name}`);
}

// Pool de navegadores lanzados bajo demanda; cerrar siempre con closeAll().
export function browserPool() {
  const launched = new Map();
  return {
    async get(kind) {
      if (!launched.has(kind)) launched.set(kind, await BROWSERS[kind].launch());
      return launched.get(kind);
    },
    async closeAll() { for (const b of launched.values()) await b.close().catch(() => {}); launched.clear(); }
  };
}

// El secreto de bypass de Vercel viaja SOLO al host propio, nunca a terceros (analytics, fuentes, mapas).
export async function applyBypass(ctx, baseHost) {
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (!bypass) return;
  await ctx.route('**/*', (route) => {
    const u = new URL(route.request().url());
    if (u.host === baseHost) return route.continue({ headers: { ...route.request().headers(), 'x-vercel-protection-bypass': bypass, 'x-vercel-set-bypass-cookie': 'true' } });
    return route.continue();
  });
}

export async function addClsObserver(ctx) {
  await ctx.addInitScript(() => {
    window.__cls = 0;
    try {
      new PerformanceObserver((l) => { for (const e of l.getEntries()) if (!e.hadRecentInput) window.__cls += e.value; }).observe({ type: 'layout-shift', buffered: true });
    } catch { window.__cls = 0; }
  });
}

export const slug = (s) => s.replace(/[^\w-]+/g, '_').replace(/^_+|_+$/g, '') || 'root';
