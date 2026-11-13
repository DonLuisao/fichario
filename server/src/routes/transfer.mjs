// Importar y exportar tarjetas en CSV, con el mismo formato que el Fichario anterior.
import { randomUUID } from 'node:crypto';
import { HttpError } from '../http.mjs';
import { cardsToCsv, parseCsv, rowsToCards } from '../csv.mjs';
import * as v from '../validate.mjs';

const MAX_IMPORT = 5000;

export function transferRoutes(router, deps) {
  const { db, now } = deps;

  const ownFolder = db.prepare('SELECT id, name FROM folders WHERE id = ? AND user_id = ? AND deleted = 0');
  const liveFolders = db.prepare('SELECT id, name FROM folders WHERE user_id = ? AND deleted = 0');
  const insertFolder = db.prepare(
    'INSERT INTO folders (id, user_id, name, color, created_at, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?, ?, 0, ?)',
  );
  const insertCard = db.prepare(
    'INSERT INTO cards (id, user_id, folder_id, question, answer, wrongs, created_at, updated_at, deleted, rev) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)',
  );
  const exportCards = db.prepare(`
    SELECT c.question, c.answer, c.wrongs, COALESCE(f.name, '') AS folder
    FROM cards c LEFT JOIN folders f ON f.id = c.folder_id AND f.deleted = 0
    WHERE c.user_id = ? AND c.deleted = 0 AND (? IS NULL OR c.folder_id = ?)
    ORDER BY folder, c.created_at, c.id
  `);

  router.post('/api/import', deps.requireWritable, async (ctx) => {
    deps.rateLimit(`import:${ctx.user.id}`, 20, 3_600_000);
    const body = await ctx.json(5 * 1024 * 1024);
    if (typeof body.csv !== 'string' || !body.csv.trim()) throw new HttpError(400, 'El archivo está vacío');
    const { cards, skipped } = rowsToCards(parseCsv(body.csv));
    if (!cards.length) throw new HttpError(400, 'No se ha encontrado ninguna tarjeta. Revisa que cada línea tenga pregunta y respuesta.');
    if (cards.length > MAX_IMPORT) throw new HttpError(413, `Como mucho ${MAX_IMPORT} tarjetas por importación`);

    const userId = ctx.user.id;
    let target = null;
    if (body.folder_id) {
      target = ownFolder.get(v.id(body.folder_id, 'La carpeta'), userId);
      if (!target) throw new HttpError(404, 'No se encuentra la carpeta');
    }

    let foldersCreated = 0;
    db.transaction(() => {
      const t = now();
      // Las carpetas del CSV se buscan por nombre, sin distinguir mayúsculas; si no existen, se crean.
      const byName = new Map(liveFolders.all(userId).map((f) => [f.name.toLowerCase(), f.id]));
      let colorIndex = byName.size;
      for (const c of cards) {
        let folderId = target?.id ?? null;
        if (!target && c.folder) {
          const name = c.folder.slice(0, 80);
          folderId = byName.get(name.toLowerCase());
          if (!folderId) {
            folderId = randomUUID();
            insertFolder.run(folderId, userId, name, v.FOLDER_COLORS[colorIndex++ % v.FOLDER_COLORS.length], t, t, db.nextRev());
            byName.set(name.toLowerCase(), folderId);
            foldersCreated++;
          }
        }
        insertCard.run(
          randomUUID(),
          userId,
          folderId,
          c.question.slice(0, 2000),
          c.answer.slice(0, 2000),
          JSON.stringify(c.wrongs.map((w) => w.slice(0, 500))),
          t,
          t,
          db.nextRev(),
        );
      }
    });
    return { imported: cards.length, skipped, folders_created: foldersCreated };
  });

  router.get('/api/export.csv', deps.requireAuth, (ctx) => {
    const folderParam = ctx.query.get('folder_id');
    let filename = 'fichario.csv';
    if (folderParam) {
      const folder = ownFolder.get(v.id(folderParam, 'La carpeta'), ctx.user.id);
      if (!folder) throw new HttpError(404, 'No se encuentra la carpeta');
      filename = `${slug(folder.name) || 'carpeta'}.csv`;
    }
    const rows = exportCards
      .all(ctx.user.id, folderParam, folderParam)
      .map((r) => ({ ...r, wrongs: JSON.parse(r.wrongs) }));
    return {
      __raw: true,
      headers: {
        'content-type': 'text/csv; charset=utf-8',
        'content-disposition': `attachment; filename="${filename}"`,
      },
      body: cardsToCsv(rows),
    };
  });
}

function slug(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 50);
}
