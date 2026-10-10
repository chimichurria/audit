import { test, expect } from '@playwright/test';

// Regresión por proyecto: un visitante sin sesión NO accede a rutas protegidas. Solo GET.
const PROTEGIDAS = ['/admin', '/dashboard', '/api/admin'];

for (const ruta of PROTEGIDAS) {
  test(`sin sesión no se accede a ${ruta}`, async ({ request }) => {
    const r = await request.get(new URL(ruta, process.env.BASE_URL ?? 'http://localhost:3000').href, { maxRedirects: 0 });
    expect([301, 302, 303, 307, 308, 401, 403, 404]).toContain(r.status());
  });
}
