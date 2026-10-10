// Sitio de prueba de 3 páginas (/, /admin, /login) en dos variantes: 'broken' y 'ok'. Solo para tests.
import http from 'node:http';

const page = (title, body, lang = 'es') => `<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title></head><body><main>${body}</main></body></html>`;

const BROKEN_HOME = page('Reservas', `
<h1>Reservá tu mesa</h1>
<form onsubmit="return false">
  <input name="nombre" placeholder="Nombre">
  <input name="whatsapp" placeholder="WhatsApp">
  <button type="submit" style="width:30px;height:30px;padding:0;font-size:10px">OK</button>
</form>`);

const OK_HOME = page('Reservas', `
<h1>Reservá tu mesa</h1>
<form id="f">
  <label for="nombre">Nombre</label>
  <input id="nombre" name="nombre" autocomplete="name" style="min-height:44px;font-size:16px">
  <label for="whatsapp">WhatsApp</label>
  <input id="whatsapp" name="whatsapp" type="tel" inputmode="tel" autocomplete="tel" style="min-height:44px;font-size:16px">
  <button type="submit" style="min-height:44px;min-width:120px;font-size:16px">Reservar</button>
  <p id="msg" role="status"></p>
</form>
<script>document.getElementById('f').addEventListener('submit', (e) => { e.preventDefault(); document.getElementById('msg').textContent = 'Reserva confirmada'; });</script>`);

export function startSite(variant) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      const html = (s, body) => { res.statusCode = s; res.setHeader('content-type', 'text/html; charset=utf-8'); res.end(body); };
      if (u.pathname === '/') return html(200, variant === 'ok' ? OK_HOME : BROKEN_HOME);
      if (u.pathname === '/login') return html(200, page('Ingresar', '<h1>Ingresar</h1>'));
      if (u.pathname === '/admin') {
        if (variant === 'ok') { res.statusCode = 302; res.setHeader('location', '/login'); return res.end(); }
        return html(200, page('Admin', '<h1>Panel de administración</h1><p>Listado de clientes</p>'));
      }
      if (u.pathname === '/api/rrpp') {
        if (variant === 'ok') { res.statusCode = 401; return res.end(); }
        res.setHeader('content-type', 'application/json'); return res.end('[{"nombre":"Prueba"}]');
      }
      html(404, page('No encontrado', '<h1>404</h1>'));
    });
    server.listen(0, '127.0.0.1', () => resolve({ url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}

export const journeysConfig = (baseUrl) => ({
  baseUrl,
  allowedHosts: ['127.0.0.1'],
  loginPathRegex: 'login',
  personas: [{ id: 'visitante', label: 'Visitante anónimo (celular)', devices: ['iPhone 13'], auth: null }],
  journeys: [{
    id: 'reservar-mesa', persona: 'visitante', goal: 'Reservar una mesa desde el celular', budget: { maxInteractions: 8, maxMs: 45000 },
    steps: [
      { action: 'goto', url: '/' },
      { action: 'fill', selector: 'input[name=nombre]', value: '{{TEST_GUEST_NAME}}' },
      { action: 'fill', selector: 'input[name=whatsapp]', value: '{{TEST_GUEST_PHONE}}' },
      { action: 'click', selector: 'button[type=submit]', submit: true },
      { action: 'expectVisible', selector: 'text=confirmad' }
    ]
  }],
  accessChecks: [
    { persona: 'visitante', type: 'page', route: '/admin', expect: 'denied', markers: ['Panel de administración'] },
    { persona: 'visitante', type: 'api', route: '/api/rrpp', expect: 'denied' },
    { persona: 'visitante', type: 'page', route: '/', expect: 'allowed' }
  ]
});
