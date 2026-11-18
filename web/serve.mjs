// Servidor para desarrollo: sirve web/dist con la CSP de producción y pasa /api al servidor local.
//   PORT=5173 API=http://127.0.0.1:3000 node serve.mjs
import { createServer, request } from 'node:http';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

const DIST = resolve('dist');
const PORT = Number(process.env.PORT ?? 5173);
const API = new URL(process.env.API ?? 'http://127.0.0.1:3000');
const CSP = /Content-Security-Policy "([^"]+)"/.exec(readFileSync(resolve('../deploy/Caddyfile'), 'utf8'))[1];
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.woff': 'font/woff', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

createServer((req, res) => {
  if (req.url.startsWith('/api/')) {
    const p = request({ host: API.hostname, port: API.port, path: req.url, method: req.method, headers: req.headers }, (r) => {
      res.writeHead(r.statusCode, r.headers);
      r.pipe(res);
    });
    p.on('error', () => res.writeHead(502).end('El servidor de la API no responde'));
    req.pipe(p);
    return;
  }
  const path = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let file = join(DIST, path);
  if (!file.startsWith(DIST) || !existsSync(file) || path.endsWith('/')) file = join(DIST, 'index.html');
  res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'content-security-policy': CSP, 'cache-control': 'no-cache' });
  res.end(readFileSync(file));
}).listen(PORT, () => console.log(`Repaso en http://localhost:${PORT} (API en ${API.origin})`));
