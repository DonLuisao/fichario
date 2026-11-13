import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.mjs';
import { burnPasswordCheck, hashPassword, newToken, sha256, verifyPassword } from '../security.mjs';
import { resetPasswordEmail } from '../email.mjs';
import * as v from '../validate.mjs';

const MINUTE = 60_000;
const HOUR = 3_600_000;

export function authRoutes(router, deps) {
  const { db, config, now, rateLimit } = deps;

  const userByEmail = db.prepare('SELECT * FROM users WHERE email = ?');
  const userById = db.prepare('SELECT * FROM users WHERE id = ?');
  const countUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
  const freeInvite = db.prepare('SELECT code FROM invites WHERE code = ? AND used_by IS NULL');
  const useInvite = db.prepare('UPDATE invites SET used_by = ?, used_at = ? WHERE code = ? AND used_by IS NULL');
  const insertUser = db.prepare(
    'INSERT INTO users (id, email, name, password_hash, is_admin, created_at, last_login_at) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );
  const setLastLogin = db.prepare('UPDATE users SET last_login_at = ? WHERE id = ?');
  const setPassword = db.prepare('UPDATE users SET password_hash = ? WHERE id = ?');
  const setName = db.prepare('UPDATE users SET name = ? WHERE id = ?');
  const deleteSession = db.prepare('DELETE FROM sessions WHERE token_hash = ?');
  const deleteSessionsOfUser = db.prepare('DELETE FROM sessions WHERE user_id = ?');
  const deleteOtherSessions = db.prepare('DELETE FROM sessions WHERE user_id = ? AND token_hash != ?');
  const insertReset = db.prepare(
    'INSERT INTO password_resets (token_hash, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)',
  );
  const findReset = db.prepare('SELECT * FROM password_resets WHERE token_hash = ?');
  const markResetUsed = db.prepare('UPDATE password_resets SET used_at = ? WHERE token_hash = ?');

  const publicUser = (u) => ({
    id: u.id,
    email: u.email,
    name: u.name ?? '',
    is_admin: u.is_admin === 1 || u.is_admin === true,
    is_demo: u.is_demo === 1 || u.is_demo === true,
  });

  // Registro con invitación. El primer usuario, si su correo es ADMIN_EMAIL, no la necesita.
  router.post('/api/auth/register', async (ctx) => {
    rateLimit(`register:${ctx.ip}`, 10, HOUR);
    const body = await ctx.json();
    const email = v.email(body.email);
    const password = v.password(body.password);
    const name = typeof body.name === 'string' ? v.text(body.name, { field: 'el nombre', max: 60 }) : '';
    const invite = typeof body.invite === 'string' ? body.invite.trim().toUpperCase() : '';

    const firstAdmin = email === config.adminEmail && countUsers.get().n === 0;
    if (!firstAdmin && !invite) throw new HttpError(400, 'Necesitas un código de invitación');
    if (userByEmail.get(email)) throw new HttpError(409, 'Ya hay una cuenta con ese correo');

    const hash = await hashPassword(password);
    const id = randomUUID();
    const t = now();
    db.transaction(() => {
      if (!firstAdmin) {
        if (!freeInvite.get(invite)) throw new HttpError(400, 'El código de invitación no es válido o ya se ha usado');
      }
      insertUser.run(id, email, name, hash, email === config.adminEmail ? 1 : 0, t, t);
      if (!firstAdmin) useInvite.run(id, t, invite);
    });

    const token = newToken();
    deps.startSession(ctx, id, token);
    return { user: publicUser(userById.get(id)) };
  });

  router.post('/api/auth/login', async (ctx) => {
    rateLimit(`login-ip:${ctx.ip}`, 20, 15 * MINUTE);
    const body = await ctx.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const password = typeof body.password === 'string' ? body.password : '';
    if (!email || !password) throw new HttpError(400, 'Escribe tu correo y tu contraseña');
    rateLimit(`login-email:${email}`, 10, 15 * MINUTE);

    const user = userByEmail.get(email);
    const ok = user ? await verifyPassword(password, user.password_hash) : (await burnPasswordCheck(password), false);
    if (!user || !ok) throw new HttpError(401, 'El correo o la contraseña no son correctos');

    setLastLogin.run(now(), user.id);
    deps.startSession(ctx, user.id, newToken());
    return { user: publicUser(user) };
  });

  router.post('/api/auth/demo', async (ctx) => {
    rateLimit(`demo:${ctx.ip}`, 20, 15 * MINUTE);
    if (!config.demoEmail || !config.demoPassword) throw new HttpError(404, 'La demo no está activada');
    const user = userByEmail.get(config.demoEmail);
    if (!user || user.is_demo !== 1 || !(await verifyPassword(config.demoPassword, user.password_hash))) {
      throw new HttpError(404, 'La demo no está disponible');
    }
    setLastLogin.run(now(), user.id);
    deps.startSession(ctx, user.id, newToken());
    return { user: publicUser(user) };
  });

  router.post('/api/auth/logout', (ctx) => {
    if (ctx.sessionHash) deleteSession.run(ctx.sessionHash);
    deps.endSession(ctx);
  });

  router.get('/api/auth/me', deps.requireAuth, (ctx) => ({ user: ctx.user }));

  router.put('/api/auth/profile', deps.requireWritable, async (ctx) => {
    const body = await ctx.json();
    const name = v.text(body.name ?? '', { field: 'el nombre', max: 60 });
    setName.run(name, ctx.user.id);
    return { user: { ...ctx.user, name } };
  });

  // Cambiar la contraseña cierra las demás sesiones abiertas.
  router.post('/api/auth/password', deps.requireWritable, async (ctx) => {
    rateLimit(`password:${ctx.user.id}`, 10, HOUR);
    const body = await ctx.json();
    const user = userById.get(ctx.user.id);
    if (!(await verifyPassword(String(body.current ?? ''), user.password_hash))) {
      throw new HttpError(400, 'La contraseña actual no es correcta');
    }
    setPassword.run(await hashPassword(v.password(body.password)), user.id);
    deleteOtherSessions.run(user.id, ctx.sessionHash);
  });

  // Siempre responde lo mismo, exista o no el correo, para no revelar quién tiene cuenta.
  router.post('/api/auth/forgot', async (ctx) => {
    rateLimit(`forgot:${ctx.ip}`, 5, HOUR);
    const body = await ctx.json();
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const user = email ? userByEmail.get(email) : null;
    if (user && user.is_demo !== 1) {
      rateLimit(`forgot-email:${email}`, 3, HOUR);
      const url = createResetLink(user.id);
      const message = resetPasswordEmail(url);
      deps.sendEmail({ to: user.email, ...message }).catch((e) => console.error('Fallo al enviar el correo:', e));
    }
    return { ok: true };
  });

  router.post('/api/auth/reset', async (ctx) => {
    rateLimit(`reset:${ctx.ip}`, 20, HOUR);
    const body = await ctx.json();
    const token = typeof body.token === 'string' ? body.token : '';
    const password = v.password(body.password);
    const row = token ? findReset.get(sha256(token)) : null;
    if (!row || row.used_at || row.expires_at <= now()) {
      throw new HttpError(400, 'El enlace no es válido o ha caducado. Pide uno nuevo.');
    }
    const hash = await hashPassword(password);
    db.transaction(() => {
      setPassword.run(hash, row.user_id);
      markResetUsed.run(now(), row.token_hash);
      // Por seguridad, se cierran todas las sesiones abiertas de esa cuenta.
      deleteSessionsOfUser.run(row.user_id);
    });
  });

  // También lo usa el panel de admin para dar un enlace a mano si el correo falla.
  function createResetLink(userId) {
    const token = newToken();
    const t = now();
    insertReset.run(sha256(token), userId, t, t + HOUR);
    return `${config.appOrigin}/restablecer#token=${token}`;
  }
  deps.createResetLink = createResetLink;
}
