import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { adminClient, DAY, invitedClient, startServer } from './helpers.mjs';

describe('cuentas y sesiones', () => {
  let app;
  let admin;
  before(async () => {
    app = await startServer();
  });
  after(() => app.close());

  test('la API responde', async () => {
    const res = await app.client().get('/api/health');
    assert.equal(res.status, 200);
    assert.equal(res.data.ok, true);
  });

  test('sin invitación solo se puede registrar el admin, y solo el primero', async () => {
    const intruso = await app.client().post('/api/auth/register', { email: 'otro@x.test', password: 'contraseña-larga' });
    assert.equal(intruso.status, 400);

    admin = await adminClient(app);
    const me = await admin.get('/api/auth/me');
    assert.equal(me.data.user.is_admin, true);
    assert.equal(me.data.user.name, 'Luis');

    const otraVez = await app.client().post('/api/auth/register', { email: 'admin@repaso.test', password: 'contraseña-larga' });
    assert.equal(otraVez.status, 400, 'el admin ya existe: hace falta invitación');
  });

  test('una invitación sirve una sola vez', async () => {
    const { data } = await admin.post('/api/admin/invites', { count: 1, note: 'Para Ana' });
    assert.match(data.codes[0], /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
    const ana = await app.client().post('/api/auth/register', { email: 'Ana@X.test', password: 'contraseña-larga', invite: data.codes[0] });
    assert.equal(ana.status, 200);
    assert.equal(ana.data.user.email, 'ana@x.test', 'el correo se guarda en minúsculas');
    const repetida = await app.client().post('/api/auth/register', { email: 'b@x.test', password: 'contraseña-larga', invite: data.codes[0] });
    assert.equal(repetida.status, 400);
  });

  test('la cookie de sesión es HttpOnly y SameSite', async () => {
    const c = app.client();
    const res = await c.post('/api/auth/login', { email: 'ana@x.test', password: 'contraseña-larga' });
    assert.equal(res.status, 200);
    const cookie = res.headers.getSetCookie()[0];
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Lax/);
    assert.doesNotMatch(cookie, /Secure/, 'en http://localhost no puede ser Secure');
  });

  test('contraseña incorrecta y usuario inexistente dan el mismo error', async () => {
    const mala = await app.client().post('/api/auth/login', { email: 'ana@x.test', password: 'no-es-esta' });
    const nadie = await app.client().post('/api/auth/login', { email: 'nadie@x.test', password: 'no-es-esta' });
    assert.equal(mala.status, 401);
    assert.equal(nadie.status, 401);
    assert.equal(mala.data.error, nadie.data.error);
  });

  test('sin sesión no hay acceso, y cerrar sesión la invalida', async () => {
    assert.equal((await app.client().get('/api/auth/me')).status, 401);
    const c = app.client();
    await c.post('/api/auth/login', { email: 'ana@x.test', password: 'contraseña-larga' });
    const robada = c.cookie;
    assert.equal((await c.post('/api/auth/logout')).status, 204);
    const otro = app.client();
    otro.cookie = robada;
    assert.equal((await otro.get('/api/auth/me')).status, 401, 'la cookie vieja ya no sirve');
  });

  test('la sesión caduca a los 30 días sin uso', async () => {
    const c = app.client();
    await c.post('/api/auth/login', { email: 'ana@x.test', password: 'contraseña-larga' });
    app.clock.t += 31 * DAY;
    assert.equal((await c.get('/api/auth/me')).status, 401);
    app.clock.t -= 31 * DAY;
  });

  test('peticiones desde otra web se rechazan (CSRF)', async () => {
    const res = await admin.post('/api/admin/invites', { count: 1 }, { origin: 'https://malvada.example' });
    assert.equal(res.status, 403);
  });

  test('solo se acepta JSON', async () => {
    const res = await app.client().request('POST', '/api/auth/login', 'email=a&password=b', {
      contentType: 'application/x-www-form-urlencoded',
    });
    assert.equal(res.status, 415);
  });

  test('demasiados intentos de login se bloquean', async () => {
    let last;
    for (let i = 0; i < 11; i++) {
      last = await app.client().post('/api/auth/login', { email: 'victima@x.test', password: `intento-${i}` });
    }
    assert.equal(last.status, 429);
    assert.ok(last.headers.get('retry-after'));
  });

  test('recuperar la contraseña: correo, enlace de un solo uso y cierre de sesiones', async () => {
    const sesionAbierta = app.client();
    await sesionAbierta.post('/api/auth/login', { email: 'ana@x.test', password: 'contraseña-larga' });

    const desconocido = await app.client().post('/api/auth/forgot', { email: 'nadie@x.test' });
    assert.equal(desconocido.status, 200, 'no revela si el correo existe');
    assert.equal(app.emails.length, 0);

    await app.client().post('/api/auth/forgot', { email: 'ana@x.test' });
    await new Promise((r) => setTimeout(r, 20));
    assert.equal(app.emails.length, 1);
    const { to, text } = app.emails[0];
    assert.equal(to, 'ana@x.test');
    const token = /#token=([A-Za-z0-9_-]+)/.exec(text)[1];
    assert.match(text, /^http/m);

    const reset = await app.client().post('/api/auth/reset', { token, password: 'nueva-contraseña' });
    assert.equal(reset.status, 204);
    assert.equal((await sesionAbierta.get('/api/auth/me')).status, 401, 'se cierran las sesiones abiertas');
    assert.equal((await app.client().post('/api/auth/reset', { token, password: 'otra-más' })).status, 400, 'un solo uso');
    const login = await app.client().post('/api/auth/login', { email: 'ana@x.test', password: 'nueva-contraseña' });
    assert.equal(login.status, 200);
  });

  test('el enlace de recuperación caduca en una hora', async () => {
    const { data } = await admin.get('/api/admin/users');
    const ana = data.users.find((u) => u.email === 'ana@x.test');
    const { data: link } = await admin.post(`/api/admin/users/${ana.id}/reset-link`);
    const token = new URL(link.url).hash.split('=')[1];
    app.clock.t += 61 * 60_000;
    assert.equal((await app.client().post('/api/auth/reset', { token, password: 'otra-contraseña' })).status, 400);
    app.clock.t -= 61 * 60_000;
  });

  test('cambiar la contraseña cierra las demás sesiones pero no la actual', async () => {
    const c = await invitedClient(app, admin, 'cambia@x.test');
    const otra = app.client();
    await otra.post('/api/auth/login', { email: 'cambia@x.test', password: 'contraseña-larga' });
    const mal = await c.post('/api/auth/password', { current: 'equivocada', password: 'nueva-contraseña' });
    assert.equal(mal.status, 400);
    assert.equal((await c.post('/api/auth/password', { current: 'contraseña-larga', password: 'nueva-contraseña' })).status, 204);
    assert.equal((await c.get('/api/auth/me')).status, 200);
    assert.equal((await otra.get('/api/auth/me')).status, 401);
  });

  test('solo el admin entra en el panel de admin', async () => {
    app.clock.t += 16 * 60_000; // pasa la ventana del límite de intentos de las pruebas anteriores
    const ana = app.client();
    await ana.post('/api/auth/login', { email: 'ana@x.test', password: 'nueva-contraseña' });
    assert.equal((await ana.get('/api/admin/users')).status, 403);
    assert.equal((await admin.get('/api/admin/users')).status, 200);
  });
});
