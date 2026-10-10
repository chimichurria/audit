// Servidor estático mínimo para fixtures (solo tests). routes: { '/path': (req, res) => {...} } tiene prioridad.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.png': 'image/png', '.json': 'application/json' };

export function serve(dir, routes = {}) {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://x');
      if (routes[u.pathname]) return routes[u.pathname](req, res);
      let file = path.join(dir, decodeURIComponent(u.pathname));
      if (!file.startsWith(dir)) { res.statusCode = 403; return res.end(); }
      if (fs.existsSync(file) && fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
      if (!fs.existsSync(file)) { res.statusCode = 404; res.setHeader('content-type', 'text/plain'); return res.end('not found'); }
      res.setHeader('content-type', TYPES[path.extname(file)] ?? 'application/octet-stream');
      fs.createReadStream(file).pipe(res);
    });
    server.listen(0, '127.0.0.1', () => resolve({ server, url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((r) => server.close(r)) }));
  });
}
