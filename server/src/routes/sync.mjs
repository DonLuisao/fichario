// Sincronización por cambios.
//
// Cada carpeta y tarjeta lleva un "rev": un contador global que el servidor sube en cada cambio.
// El cliente envía sus cambios pendientes y el último rev que conoce; recibe todo lo que ha
// cambiado después (incluidos los borrados, como "tombstones") y el rev nuevo.
//
// Si dos dispositivos cambian lo mismo, gana el último que llega al servidor. La hora la pone
// siempre el servidor, así que un reloj desajustado en un móvil no puede pisar cambios.
import { HttpError } from '../http.mjs';
import * as v from '../validate.mjs';

const LIMITS = { folders: 1000, cards: 5000, reviews: 10000 };
const DAY = 86_400_000;

export function syncRoutes(router, deps) {
  const { db, now } = deps;

  const upsertFolder = db.prepare(`
    INSERT INTO folders (id, user_id, name, color, created_at, updated_at, deleted, rev)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT (id) DO UPDATE SET
      name = excluded.name, color = excluded.color, updated_at = excluded.updated_at,
      deleted = 0, rev = excluded.rev
    WHERE folders.user_id = excluded.user_id
  `);
  const deleteFolder = db.prepare(
    'UPDATE folders SET deleted = 1, updated_at = ?, rev = ? WHERE id = ? AND user_id = ? AND deleted = 0',
  );
  const cardsInFolder = db.prepare('SELECT id FROM cards WHERE folder_id = ? AND user_id = ? AND deleted = 0');
  const deleteShareOfFolder = db.prepare('DELETE FROM shares WHERE folder_id = ?');
  const ownFolder = db.prepare('SELECT id FROM folders WHERE id = ? AND user_id = ? AND deleted = 0');

  const upsertCard = db.prepare(`
    INSERT INTO cards (id, user_id, folder_id, question, answer, wrongs, created_at, updated_at, deleted, rev)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT (id) DO UPDATE SET
      folder_id = excluded.folder_id, question = excluded.question, answer = excluded.answer,
      wrongs = excluded.wrongs, updated_at = excluded.updated_at, deleted = 0, rev = excluded.rev
    WHERE cards.user_id = excluded.user_id
  `);
  const deleteCard = db.prepare(
    'UPDATE cards SET deleted = 1, updated_at = ?, rev = ? WHERE id = ? AND user_id = ? AND deleted = 0',
  );
  const ownCard = db.prepare('SELECT id FROM cards WHERE id = ? AND user_id = ?');
  const insertReview = db.prepare(
    'INSERT OR IGNORE INTO reviews (id, user_id, card_id, correct, mode, answered_at) VALUES (?, ?, ?, ?, ?, ?)',
  );

  const foldersSince = db.prepare(
    'SELECT id, name, color, source, deleted, updated_at, rev FROM folders WHERE user_id = ? AND rev > ? ORDER BY rev',
  );
  const cardsSince = db.prepare(
    'SELECT id, folder_id, question, answer, wrongs, deleted, updated_at, rev FROM cards WHERE user_id = ? AND rev > ? ORDER BY rev',
  );

  router.post('/api/sync', deps.requireAuth, async (ctx) => {
    deps.rateLimit(`sync:${ctx.user.id}`, 120, 60_000);
    const body = await ctx.json(5 * 1024 * 1024);
    const since = Number.isInteger(body.since) && body.since >= 0 ? body.since : 0;
    const changes = body.changes && typeof body.changes === 'object' ? body.changes : {};
    const folders = Array.isArray(changes.folders) ? changes.folders : [];
    const cards = Array.isArray(changes.cards) ? changes.cards : [];
    const reviews = Array.isArray(changes.reviews) ? changes.reviews : [];
    for (const [key, list] of Object.entries({ folders, cards, reviews })) {
      if (list.length > LIMITS[key]) throw new HttpError(413, `Demasiados cambios de ${key} en una sola sincronización`);
    }

    const userId = ctx.user.id;
    // Se valida todo antes de tocar la base de datos: o entra todo, o nada.
    const folderOps = folders.map(parseFolder);
    const cardOps = cards.map(parseCard);
    const reviewOps = reviews.map((r) => parseReview(r, now()));

    // La cuenta demo puede leer, pero sus cambios no se guardan.
    if (!ctx.user.is_demo) {
      db.transaction(() => {
        const t = now();
        for (const f of folderOps) {
          if (f.deleted) {
            const rev = db.nextRev();
            if (deleteFolder.run(t, rev, f.id, userId).changes) {
              // Borrar una carpeta borra sus tarjetas y deja de compartirla.
              for (const { id } of cardsInFolder.all(f.id, userId)) deleteCard.run(t, db.nextRev(), id, userId);
              deleteShareOfFolder.run(f.id);
            }
          } else {
            upsertFolder.run(f.id, userId, f.name, f.color, t, t, db.nextRev());
          }
        }
        for (const c of cardOps) {
          if (c.deleted) {
            deleteCard.run(t, db.nextRev(), c.id, userId);
          } else {
            const folderId = c.folder_id && ownFolder.get(c.folder_id, userId) ? c.folder_id : null;
            upsertCard.run(c.id, userId, folderId, c.question, c.answer, JSON.stringify(c.wrongs), t, t, db.nextRev());
          }
        }
        for (const r of reviewOps) {
          if (ownCard.get(r.card_id, userId)) {
            insertReview.run(r.id, userId, r.card_id, r.correct ? 1 : 0, r.mode, r.answered_at);
          }
        }
      });
    }

    return {
      rev: db.currentRev(),
      folders: foldersSince.all(userId, since).map((f) => ({ ...f, deleted: f.deleted === 1 })),
      cards: cardsSince.all(userId, since).map((c) => ({ ...c, wrongs: JSON.parse(c.wrongs), deleted: c.deleted === 1 })),
    };
  });
}

function parseFolder(f) {
  if (!f || typeof f !== 'object') throw new HttpError(400, 'Carpeta no válida');
  const id = v.id(f.id, 'El identificador de carpeta');
  if (f.deleted === true) return { id, deleted: true };
  const name = v.text(f.name, { field: 'el nombre de la carpeta', min: 1, max: 80 });
  const color = typeof f.color === 'string' && v.COLOR_RE.test(f.color) ? f.color.toLowerCase() : '';
  return { id, name, color, deleted: false };
}

function parseCard(c) {
  if (!c || typeof c !== 'object') throw new HttpError(400, 'Tarjeta no válida');
  const id = v.id(c.id, 'El identificador de tarjeta');
  if (c.deleted === true) return { id, deleted: true };
  const question = v.text(c.question, { field: 'la pregunta', min: 1, max: 2000 });
  const answer = v.text(c.answer, { field: 'la respuesta', min: 1, max: 2000 });
  const wrongs = (Array.isArray(c.wrongs) ? c.wrongs : [])
    .filter((w) => typeof w === 'string' && w.trim())
    .slice(0, 3)
    .map((w) => v.text(w, { field: 'una respuesta falsa', max: 500 }));
  const folder_id = typeof c.folder_id === 'string' && v.ID_RE.test(c.folder_id) ? c.folder_id : null;
  return { id, question, answer, wrongs, folder_id, deleted: false };
}

function parseReview(r, t) {
  if (!r || typeof r !== 'object') throw new HttpError(400, 'Respuesta no válida');
  const answered = Number(r.answered_at);
  return {
    id: v.id(r.id, 'El identificador de respuesta'),
    card_id: v.id(r.card_id, 'La tarjeta de la respuesta'),
    correct: r.correct === true,
    mode: r.mode === 'quiz' ? 'quiz' : 'flip',
    // Respuestas hechas sin conexión llegan más tarde; se aceptan hasta un año atrás.
    answered_at: Number.isFinite(answered) && answered > t - 365 * DAY && answered <= t + DAY ? Math.round(answered) : t,
  };
}
