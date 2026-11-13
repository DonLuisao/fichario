// Panel de administración: invitaciones, usuarios y cuenta demo.
import { HttpError } from '../http.mjs';
import { newInviteCode } from '../security.mjs';
import * as v from '../validate.mjs';

export function adminRoutes(router, deps) {
  const { db, now } = deps;

  const listInvites = db.prepare(`
    SELECT i.code, i.note, i.created_at, i.used_at, u.email AS used_by_email
    FROM invites i LEFT JOIN users u ON u.id = i.used_by
    ORDER BY i.created_at DESC LIMIT 200
  `);
  const insertInvite = db.prepare('INSERT INTO invites (code, created_by, created_at, note) VALUES (?, ?, ?, ?)');
  const inviteExists = db.prepare('SELECT 1 FROM invites WHERE code = ?');
  const findInvite = db.prepare('SELECT used_by FROM invites WHERE code = ?');
  const deleteInvite = db.prepare('DELETE FROM invites WHERE code = ?');
  const listUsers = db.prepare(`
    SELECT u.id, u.email, u.name, u.is_admin, u.is_demo, u.created_at, u.last_login_at,
           (SELECT COUNT(*) FROM cards c WHERE c.user_id = u.id AND c.deleted = 0) AS cards
    FROM users u ORDER BY u.created_at
  `);
  const userById = db.prepare('SELECT id, is_admin FROM users WHERE id = ?');
  const setDemo = db.prepare('UPDATE users SET is_demo = ? WHERE id = ?');
  const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');

  function targetUser(ctx) {
    const user = userById.get(v.id(ctx.params.id, 'El usuario'));
    if (!user) throw new HttpError(404, 'No se encuentra el usuario');
    return user;
  }

  router.get('/api/admin/invites', deps.requireAdmin, () => ({ invites: listInvites.all() }));

  router.post('/api/admin/invites', deps.requireAdmin, async (ctx) => {
    const body = await ctx.json();
    const count = Math.min(Math.max(Number.parseInt(body.count, 10) || 1, 1), 50);
    const note = typeof body.note === 'string' ? v.text(body.note, { field: 'la nota', max: 120 }) : '';
    const codes = [];
    db.transaction(() => {
      for (let i = 0; i < count; i++) {
        let code;
        do code = newInviteCode();
        while (inviteExists.get(code));
        insertInvite.run(code, ctx.user.id, now(), note);
        codes.push(code);
      }
    });
    return { codes };
  });

  router.delete('/api/admin/invites/:code', deps.requireAdmin, (ctx) => {
    const invite = findInvite.get(ctx.params.code);
    if (!invite) throw new HttpError(404, 'No se encuentra la invitación');
    if (invite.used_by) throw new HttpError(400, 'Esa invitación ya se ha usado');
    deleteInvite.run(ctx.params.code);
  });

  router.get('/api/admin/users', deps.requireAdmin, () => ({
    users: listUsers.all().map((u) => ({ ...u, is_admin: u.is_admin === 1, is_demo: u.is_demo === 1 })),
  }));

  router.post('/api/admin/users/:id/demo', deps.requireAdmin, async (ctx) => {
    const user = targetUser(ctx);
    if (user.is_admin) throw new HttpError(400, 'Una cuenta de administrador no puede ser la demo');
    const body = await ctx.json();
    setDemo.run(body.is_demo === true ? 1 : 0, user.id);
    return { is_demo: body.is_demo === true };
  });

  // Enlace de recuperación hecho a mano, por si el correo no llega.
  router.post('/api/admin/users/:id/reset-link', deps.requireAdmin, (ctx) => ({ url: deps.createResetLink(targetUser(ctx).id) }));

  router.delete('/api/admin/users/:id', deps.requireAdmin, (ctx) => {
    const user = targetUser(ctx);
    if (user.id === ctx.user.id) throw new HttpError(400, 'No puedes borrar tu propia cuenta desde aquí');
    deleteUser.run(user.id);
  });
}
