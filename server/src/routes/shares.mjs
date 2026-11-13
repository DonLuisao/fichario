// Carpetas compartidas por enlace. Quien comparte decide si el enlace es "solo ver" o
// "puede hacerse una copia". Las estadísticas no se comparten nunca.
import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.mjs';
import { newToken } from '../security.mjs';
import * as v from '../validate.mjs';

export function shareRoutes(router, deps) {
  const { db, config, now } = deps;

  const ownFolder = db.prepare('SELECT * FROM folders WHERE id = ? AND user_id = ? AND deleted = 0');
  const shareOfFolder = db.prepare('SELECT token, mode, created_at FROM shares WHERE folder_id = ?');
  const insertShare = db.prepare('INSERT INTO shares (token, folder_id, user_id, mode, created_at) VALUES (?, ?, ?, ?, ?)');
  const updateShare = db.prepare('UPDATE shares SET mode = ? WHERE folder_id = ?');
  const deleteShare = db.prepare('DELETE FROM shares WHERE folder_id = ?');
  const sharedByToken = db.prepare(`
    SELECT s.mode, f.id AS folder_id, f.name, f.color, u.name AS owner
    FROM shares s
    JOIN folders f ON f.id = s.folder_id AND f.deleted = 0
    JOIN users u ON u.id = s.user_id
    WHERE s.token = ?
  `);
  const cardsOfFolder = db.prepare(
    'SELECT id, question, answer, wrongs FROM cards WHERE folder_id = ? AND deleted = 0 ORDER BY created_at, id',
  );
  const insertFolder = db.prepare(
    'INSERT INTO folders (id, user_id, name, color, source, created_at, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)',
  );
  const insertCard = db.prepare(
    'INSERT INTO cards (id, user_id, folder_id, question, answer, wrongs, created_at, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
  );

  const view = (share) => (share ? { token: share.token, mode: share.mode, url: `${config.appOrigin}/c/${share.token}` } : null);

  function folderOf(ctx) {
    const folder = ownFolder.get(v.id(ctx.params.id, 'La carpeta'), ctx.user.id);
    if (!folder) throw new HttpError(404, 'No se encuentra la carpeta');
    return folder;
  }

  router.get('/api/folders/:id/share', deps.requireAuth, (ctx) => ({ share: view(shareOfFolder.get(folderOf(ctx).id)) }));

  router.post('/api/folders/:id/share', deps.requireWritable, async (ctx) => {
    const folder = folderOf(ctx);
    const body = await ctx.json();
    const mode = body.mode === 'view' ? 'view' : 'copy';
    if (shareOfFolder.get(folder.id)) updateShare.run(mode, folder.id);
    else insertShare.run(newToken(12), folder.id, ctx.user.id, mode, now());
    return { share: view(shareOfFolder.get(folder.id)) };
  });

  router.delete('/api/folders/:id/share', deps.requireWritable, (ctx) => {
    deleteShare.run(folderOf(ctx).id);
  });

  function sharedFolder(ctx) {
    const token = ctx.params.token;
    const shared = /^[A-Za-z0-9_-]{8,64}$/.test(token) ? sharedByToken.get(token) : null;
    if (!shared) throw new HttpError(404, 'Este enlace no existe o ya no se comparte');
    return shared;
  }

  // Público: no hace falta cuenta para ver una carpeta compartida.
  router.get('/api/shared/:token', (ctx) => {
    deps.rateLimit(`shared:${ctx.ip}`, 60, 60_000);
    const shared = sharedFolder(ctx);
    const cards = cardsOfFolder.all(shared.folder_id).map((c) => ({ ...c, wrongs: JSON.parse(c.wrongs) }));
    return {
      folder: { name: shared.name, color: shared.color },
      owner: shared.owner || '',
      mode: shared.mode,
      cards,
    };
  });

  // Copia la carpeta en la cuenta de quien la abre. Desde ese momento es independiente.
  router.post('/api/shared/:token/copy', deps.requireWritable, (ctx) => {
    deps.rateLimit(`copy:${ctx.user.id}`, 30, 3_600_000);
    const shared = sharedFolder(ctx);
    if (shared.mode !== 'copy') throw new HttpError(403, 'Este enlace es solo para ver las tarjetas');
    const folderId = randomUUID();
    const cards = cardsOfFolder.all(shared.folder_id);
    db.transaction(() => {
      const t = now();
      insertFolder.run(folderId, ctx.user.id, shared.name, shared.color, shared.owner || 'otra persona', t, t, db.nextRev());
      for (const c of cards) {
        insertCard.run(randomUUID(), ctx.user.id, folderId, c.question, c.answer, c.wrongs, t, t, db.nextRev());
      }
    });
    return { folder_id: folderId, cards: cards.length };
  });
}
