// Arranca un servidor de prueba con base de datos en memoria y un reloj controlable.
import { createApp } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { openDb } from '../src/db.mjs';

export const ORIGIN = 'http://localhost:5173';
export const DAY = 86_400_000;

export async function startServer(env = {}) {
  const config = loadConfig({
    APP_ORIGIN: ORIGIN,
    ADMIN_EMAIL: 'admin@repaso.test',
    DEMO_EMAIL: 'demo@repaso.test',
    DEMO_PASSWORD: 'demo-1234',
    ...env,
  });
  const db = openDb(':memory:');
  const emails = [];
  const clock = { t: Date.UTC(2026, 10, 13, 12, 0, 0) };
  const server = createApp({
    config,
    db,
    now: () => clock.t,
    sendEmail: async (msg) => {
      emails.push(msg);
      return { ok: true };
    },
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    db,
    emails,
    clock,
    client: () => new Client(base),
    close: () => new Promise((resolve) => server.close(() => (db.close(), resolve()))),
  };
}

// Cliente HTTP con su propia cookie de sesión, como un navegador.
export class Client {
  constructor(base) {
    this.base = base;
    this.cookie = '';
  }

  async request(method, path, body, { origin = ORIGIN, contentType = 'application/json', raw = false } = {}) {
    const headers = {};
    if (origin) headers.origin = origin;
    if (this.cookie) headers.cookie = this.cookie;
    let payload;
    if (body !== undefined) {
      headers['content-type'] = contentType;
      payload = typeof body === 'string' ? body : JSON.stringify(body);
    }
    const res = await fetch(this.base + path, { method, headers, body: payload });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const value = pair.slice(pair.indexOf('=') + 1);
      this.cookie = value ? pair : '';
    }
    const text = await res.text();
    let data = text;
    if (!raw && (res.headers.get('content-type') ?? '').includes('json') && text) data = JSON.parse(text);
    return { status: res.status, data, headers: res.headers };
  }

  get(path, opts) {
    return this.request('GET', path, undefined, opts);
  }
  post(path, body = {}, opts) {
    return this.request('POST', path, body, opts);
  }
  put(path, body = {}, opts) {
    return this.request('PUT', path, body, opts);
  }
  delete(path, opts) {
    return this.request('DELETE', path, undefined, opts);
  }
}

// Crea el admin y devuelve su cliente ya con sesión.
export async function adminClient(app) {
  const admin = app.client();
  const res = await admin.post('/api/auth/register', { email: 'admin@repaso.test', password: 'contraseña-admin', name: 'Luis' });
  if (res.status !== 200) throw new Error(`No se pudo crear el admin: ${JSON.stringify(res.data)}`);
  return admin;
}

// Crea un usuario con una invitación del admin.
export async function invitedClient(app, admin, email, name = '') {
  const { data } = await admin.post('/api/admin/invites', { count: 1 });
  const c = app.client();
  const res = await c.post('/api/auth/register', { email, password: 'contraseña-larga', invite: data.codes[0], name });
  if (res.status !== 200) throw new Error(`No se pudo registrar ${email}: ${JSON.stringify(res.data)}`);
  return c;
}
