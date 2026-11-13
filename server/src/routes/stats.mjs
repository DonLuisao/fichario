// Estadísticas, calculadas a partir de cada respuesta guardada.
import { HttpError } from '../http.mjs';

const DAY = 86_400_000;
const HEATMAP_DAYS = 84;

export function statsRoutes(router, deps) {
  const { db, now } = deps;

  const reviewsOfUser = db.prepare(`
    SELECT r.card_id, r.correct, r.answered_at
    FROM reviews r JOIN cards c ON c.id = r.card_id AND c.deleted = 0
    WHERE r.user_id = ?
    ORDER BY r.answered_at
  `);
  const allReviewTimes = db.prepare('SELECT answered_at FROM reviews WHERE user_id = ? ORDER BY answered_at');
  const liveCards = db.prepare('SELECT id, folder_id FROM cards WHERE user_id = ? AND deleted = 0');
  const liveFolders = db.prepare('SELECT id, name, color FROM folders WHERE user_id = ? AND deleted = 0 ORDER BY name');

  router.get('/api/stats', deps.requireAuth, (ctx) => {
    const tz = ctx.query.get('tz') || 'Europe/Madrid';
    let dayOf;
    try {
      const fmt = new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' });
      dayOf = (ms) => fmt.format(new Date(ms));
    } catch {
      throw new HttpError(400, 'Zona horaria no válida');
    }

    const userId = ctx.user.id;
    const t = now();
    const today = dayOf(t);

    // Actividad por día (todas las respuestas, también de tarjetas ya borradas)
    const perDay = new Map();
    for (const { answered_at } of allReviewTimes.all(userId)) {
      const d = dayOf(answered_at);
      perDay.set(d, (perDay.get(d) ?? 0) + 1);
    }
    const heatmap = [];
    for (let i = HEATMAP_DAYS - 1; i >= 0; i--) {
      const d = dayOf(t - i * DAY);
      heatmap.push({ day: d, count: perDay.get(d) ?? 0 });
    }

    // Racha: días seguidos con al menos una respuesta, contando desde hoy (o ayer, si hoy aún no)
    let streak = 0;
    let cursor = perDay.has(today) ? t : t - DAY;
    while (perDay.has(dayOf(cursor))) {
      streak++;
      cursor -= DAY;
    }

    // Por tarjeta y por carpeta
    const folderOfCard = new Map(liveCards.all(userId).map((c) => [c.id, c.folder_id]));
    const cards = {};
    let monthAnswers = 0;
    let monthCorrect = 0;
    for (const r of reviewsOfUser.all(userId)) {
      const s = (cards[r.card_id] ??= { attempts: 0, correct: 0, last: '', last_at: 0 });
      s.attempts++;
      s.correct += r.correct;
      s.last = (s.last + (r.correct ? '1' : '0')).slice(-10);
      s.last_at = r.answered_at;
      if (r.answered_at > t - 30 * DAY) {
        monthAnswers++;
        monthCorrect += r.correct;
      }
    }

    const folderTotals = new Map();
    for (const [cardId, folderId] of folderOfCard) {
      const f = folderTotals.get(folderId) ?? { cards: 0, attempts: 0, correct: 0 };
      f.cards++;
      if (cards[cardId]) {
        f.attempts += cards[cardId].attempts;
        f.correct += cards[cardId].correct;
      }
      folderTotals.set(folderId, f);
    }
    const folders = liveFolders.all(userId).map((f) => {
      const tot = folderTotals.get(f.id) ?? { cards: 0, attempts: 0, correct: 0 };
      return { id: f.id, name: f.name, color: f.color, cards: tot.cards, attempts: tot.attempts, accuracy: tot.attempts ? tot.correct / tot.attempts : null };
    });

    // Tarjetas flojas: al menos 3 intentos y menos de la mitad bien en los últimos 10
    const weak = Object.entries(cards)
      .map(([card_id, s]) => ({ card_id, recent: s.last.length, accuracy: [...s.last].filter((x) => x === '1').length / s.last.length }))
      .filter((w) => w.recent >= 3 && w.accuracy < 0.5)
      .sort((a, b) => a.accuracy - b.accuracy)
      .map(({ card_id, accuracy }) => ({ card_id, accuracy }));

    return {
      today,
      streak,
      total_cards: folderOfCard.size,
      month: { answers: monthAnswers, accuracy: monthAnswers ? monthCorrect / monthAnswers : null },
      heatmap,
      folders,
      weak,
      cards,
    };
  });
}
