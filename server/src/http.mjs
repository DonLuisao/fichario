// Utilidades HTTP mínimas: enrutado, cuerpo JSON, cookies, errores y límites de peticiones.

export class HttpError extends Error {
  constructor(status, message, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

export function createRouter() {
  const routes = [];
  const add = (method, pattern, ...handlers) => {
    const keys = [];
    const regex = new RegExp(
      '^' +
        pattern.replace(/\/:([a-zA-Z_]+)/g, (_, key) => {
          keys.push(key);
          return '/([^/]+)';
        }) +
        '$',
    );
    routes.push({ method, regex, keys, handlers });
  };
  return {
    get: (p, ...h) => add('GET', p, ...h),
    post: (p, ...h) => add('POST', p, ...h),
    put: (p, ...h) => add('PUT', p, ...h),
    delete: (p, ...h) => add('DELETE', p, ...h),
    match(method, path) {
      let pathExists = false;
      for (const route of routes) {
        const m = route.regex.exec(path);
        if (!m) continue;
        pathExists = true;
        if (route.method !== method) continue;
        const params = {};
        route.keys.forEach((k, i) => (params[k] = decodeURIComponent(m[i + 1])));
        return { handlers: route.handlers, params };
      }
      return pathExists ? { methodNotAllowed: true } : null;
    },
  };
}

export async function readJson(req, limitBytes) {
  const type = req.headers['content-type'] ?? '';
  if (!type.startsWith('application/json')) {
    throw new HttpError(415, 'El cuerpo debe ser JSON');
  }
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limitBytes) throw new HttpError(413, 'Petición demasiado grande');
    chunks.push(chunk);
  }
  if (!size) return {};
  try {
    const value = JSON.parse(Buffer.concat(chunks).toString('utf8'));
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error();
    return value;
  } catch {
    throw new HttpError(400, 'JSON no válido');
  }
}

export function parseCookies(header = '') {
  const out = {};
  for (const part of header.split(';')) {
    const i = part.indexOf('=');
    if (i < 0) continue;
    const key = part.slice(0, i).trim();
    if (key) out[key] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export function serializeCookie(name, value, { maxAge, secure }) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (maxAge !== undefined) parts.push(`Max-Age=${maxAge}`);
  if (secure) parts.push('Secure');
  return parts.join('; ');
}

export function sendJson(res, status, body, headers = {}) {
  const payload = body === undefined ? '' : JSON.stringify(body);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
    ...headers,
  });
  res.end(payload);
}

// Límite de peticiones en memoria, por ventana fija. Suficiente para un solo servidor.
export function createRateLimiter(now = () => Date.now()) {
  const buckets = new Map();
  const timer = setInterval(() => {
    const t = now();
    for (const [key, b] of buckets) if (b.resetAt <= t) buckets.delete(key);
  }, 60_000);
  timer.unref();
  return function hit(key, max, windowMs) {
    const t = now();
    let b = buckets.get(key);
    if (!b || b.resetAt <= t) {
      b = { count: 0, resetAt: t + windowMs };
      buckets.set(key, b);
    }
    b.count += 1;
    if (b.count > max) {
      const retry = Math.ceil((b.resetAt - t) / 1000);
      throw new HttpError(429, 'Demasiados intentos. Espera un poco y vuelve a probar.', {
        headers: { 'retry-after': String(retry) },
      });
    }
  };
}
