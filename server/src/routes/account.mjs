// La cuenta de cada usuario: descargar todos sus datos y borrarla (RGPD).
import { HttpError } from '../http.mjs';
import { verifyPassword } from '../security.mjs';

export function accountRoutes(router, deps) {
  const { db, now } = deps;

  const user = db.prepare('SELECT id, email, name, password_hash, is_admin, created_at, last_login_at FROM users WHERE id = ?');
  const folders = db.prepare('SELECT id, name, color, source, created_at, updated_at FROM folders WHERE user_id = ? AND deleted = 0 ORDER BY name');
  const cards = db.prepare(
    'SELECT id, folder_id, question, answer, wrongs, created_at, updated_at FROM cards WHERE user_id = ? AND deleted = 0 ORDER BY created_at, id',
  );
  const reviews = db.prepare('SELECT card_id, correct, mode, answered_at FROM reviews WHERE user_id = ? ORDER BY answered_at');
  const shares = db.prepare('SELECT folder_id, mode, created_at FROM shares WHERE user_id = ?');
  const deleteUser = db.prepare('DELETE FROM users WHERE id = ?');

  router.get('/api/account/export', deps.requireAuth, (ctx) => {
    deps.rateLimit(`export-account:${ctx.user.id}`, 10, 3_600_000);
    const u = user.get(ctx.user.id);
    const data = {
      exported_at: new Date(now()).toISOString(),
      user: { email: u.email, name: u.name, created_at: u.created_at, last_login_at: u.last_login_at },
      folders: folders.all(u.id),
      cards: cards.all(u.id).map((c) => ({ ...c, wrongs: JSON.parse(c.wrongs) })),
      reviews: reviews.all(u.id).map((r) => ({ ...r, correct: r.correct === 1 })),
      shares: shares.all(u.id),
    };
    return {
      __raw: true,
      headers: {
        'content-type': 'application/json; charset=utf-8',
        'content-disposition': 'attachment; filename="fichario-mis-datos.json"',
      },
      body: JSON.stringify(data, null, 2),
    };
  });

  // Borra la cuenta y todo lo suyo: carpetas, tarjetas, respuestas, enlaces compartidos y sesiones.
  router.post('/api/account/delete', deps.requireWritable, async (ctx) => {
    deps.rateLimit(`delete-account:${ctx.user.id}`, 5, 3_600_000);
    const body = await ctx.json();
    const u = user.get(ctx.user.id);
    if (u.is_admin === 1) throw new HttpError(400, 'La cuenta de administrador no se puede borrar desde aquí');
    if (!(await verifyPassword(String(body.password ?? ''), u.password_hash))) {
      throw new HttpError(400, 'La contraseña no es correcta');
    }
    deleteUser.run(u.id);
    deps.endSession(ctx);
  });
}
