// Crea el servidor HTTP de la API. Se usa igual en producción y en las pruebas.
import { createServer } from 'node:http';
import { createRouter, createRateLimiter, HttpError, parseCookies, readJson, sendJson, serializeCookie } from './http.mjs';
import { sha256 } from './security.mjs';
import { authRoutes } from './routes/auth.mjs';
import { syncRoutes } from './routes/sync.mjs';
import { statsRoutes } from './routes/stats.mjs';
import { shareRoutes } from './routes/shares.mjs';
import { transferRoutes } from './routes/transfer.mjs';
import { adminRoutes } from './routes/admin.mjs';
import { accountRoutes } from './routes/account.mjs';

export const SESSION_COOKIE = 'fichario_sesion';
export const SESSION_DAYS = 30;
const DAY = 86_400_000;
const UNSAFE = new Set(['POST', 'PUT', 'DELETE']);

export function createApp({ config, db, sendEmail, now = () => Date.now() }) {
  const router = createRouter();
  const rateLimit = createRateLimiter(now);

  const findSession = db.prepare(`
    SELECT s.token_hash, s.last_seen_at, u.id, u.email, u.name, u.is_admin, u.is_demo
    FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.token_hash = ? AND s.expires_at > ?
  `);
  const touchSession = db.prepare('UPDATE sessions SET last_seen_at = ?, expires_at = ? WHERE token_hash = ?');
  const insertSession = db.prepare(
    'INSERT INTO sessions (token_hash, user_id, created_at, last_seen_at, expires_at) VALUES (?, ?, ?, ?, ?)',
  );
  const purgeSessions = db.prepare('DELETE FROM sessions WHERE expires_at <= ?');

  const deps = {
    config,
    db,
    sendEmail,
    now,
    rateLimit,
    // Middlewares
    requireAuth(ctx) {
      if (!ctx.user) throw new HttpError(401, 'Inicia sesión para continuar');
    },
    requireWritable(ctx) {
      if (!ctx.user) throw new HttpError(401, 'Inicia sesión para continuar');
      if (ctx.user.is_demo) throw new HttpError(403, 'La cuenta de demostración es de solo lectura', { demo: true });
    },
    requireAdmin(ctx) {
      if (!ctx.user) throw new HttpError(401, 'Inicia sesión para continuar');
      if (!ctx.user.is_admin) throw new HttpError(403, 'Solo para administradores');
    },
    startSession(ctx, userId, token) {
      const t = now();
      insertSession.run(sha256(token), userId, t, t, t + SESSION_DAYS * DAY);
      ctx.setCookie(serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86_400, secure: config.secureCookies }));
    },
    endSession(ctx) {
      ctx.setCookie(serializeCookie(SESSION_COOKIE, '', { maxAge: 0, secure: config.secureCookies }));
    },
  };

  authRoutes(router, deps);
  syncRoutes(router, deps);
  statsRoutes(router, deps);
  shareRoutes(router, deps);
  transferRoutes(router, deps);
  adminRoutes(router, deps);
  accountRoutes(router, deps);
  router.get('/api/health', () => ({ ok: true, version: '2.0.0' }));

  const purgeTimer = setInterval(() => purgeSessions.run(now()), 6 * 3_600_000);
  purgeTimer.unref();

  const server = createServer(async (req, res) => {
    const cookies = [];
    const extraHeaders = {};
    try {
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/')) throw new HttpError(404, 'No encontrado');

      // Protección CSRF: las peticiones que cambian algo tienen que venir de la propia app.
      // La cookie ya es SameSite=Lax; esto lo refuerza.
      if (UNSAFE.has(req.method)) {
        const origin = req.headers.origin;
        if (origin && origin !== config.appOrigin) throw new HttpError(403, 'Origen no permitido');
      }

      const match = router.match(req.method, url.pathname);
      if (!match) throw new HttpError(404, 'Ruta no encontrada');
      if (match.methodNotAllowed) throw new HttpError(405, 'Método no permitido');

      const ip =
        (config.clientIpHeader && String(req.headers[config.clientIpHeader] ?? '').split(',')[0].trim()) ||
        req.socket.remoteAddress ||
        'desconocida';

      const ctx = {
        req,
        res,
        url,
        ip,
        params: match.params,
        query: url.searchParams,
        user: null,
        json: (limit = 64 * 1024) => readJson(req, limit),
        setCookie: (c) => cookies.push(c),
        setHeader: (k, v) => (extraHeaders[k] = v),
      };

      // Sesión: la cookie lleva un token; en la base de datos solo está su hash.
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE];
      if (token) {
        const t = now();
        const row = findSession.get(sha256(token), t);
        if (row) {
          ctx.user = {
            id: row.id,
            email: row.email,
            name: row.name,
            is_admin: row.is_admin === 1,
            is_demo: row.is_demo === 1,
          };
          ctx.sessionHash = row.token_hash;
          // Sesión deslizante: si se usa, se alarga. Se renueva como mucho una vez al día.
          if (t - row.last_seen_at > DAY) {
            touchSession.run(t, t + SESSION_DAYS * DAY, row.token_hash);
            ctx.setCookie(serializeCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86_400, secure: config.secureCookies }));
          }
        }
      }

      let result;
      for (const handler of match.handlers) {
        result = await handler(ctx);
      }

      if (res.headersSent) return;
      if (cookies.length) extraHeaders['set-cookie'] = cookies;
      if (result && result.__raw) {
        res.writeHead(result.status ?? 200, { 'cache-control': 'no-store', ...result.headers, ...extraHeaders });
        res.end(result.body);
        return;
      }
      sendJson(res, result === undefined ? 204 : 200, result, extraHeaders);
    } catch (error) {
      if (res.headersSent) return;
      if (cookies.length) extraHeaders['set-cookie'] = cookies;
      if (error instanceof HttpError) {
        const { headers = {}, ...extra } = error.extra;
        sendJson(res, error.status, { error: error.message, ...extra }, { ...headers, ...extraHeaders });
      } else {
        console.error(error);
        sendJson(res, 500, { error: 'Error interno del servidor' }, extraHeaders);
      }
    }
  });

  server.on('close', () => clearInterval(purgeTimer));
  return server;
}
