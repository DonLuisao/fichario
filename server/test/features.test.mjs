import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { adminClient, DAY, invitedClient, startServer } from './helpers.mjs';

describe('importar y exportar CSV', () => {
  let app;
  let luis;
  before(async () => {
    app = await startServer();
    const admin = await adminClient(app);
    luis = await invitedClient(app, admin, 'luis@x.test');
  });
  after(() => app.close());

  // El formato exacto que exportaba el Fichario anterior
  const ANTIGUO = [
    '¿Hosts en un /26?,62,64,30,126,Redes',
    '"Define ""latencia""","Tiempo de ida, en ms",,,,Redes',
    '"Pregunta con',
    'salto de línea",Respuesta,,,,SQL',
    'Sin carpeta,Vale',
    ',solo respuesta',
    '',
  ].join('\n');

  test('importa el CSV del Fichario anterior, con comillas, comas y saltos de línea', async () => {
    const res = await luis.post('/api/import', { csv: ANTIGUO });
    assert.equal(res.status, 200);
    assert.deepEqual(res.data, { imported: 4, skipped: 1, folders_created: 2 });
    const { data } = await luis.post('/api/sync', { since: 0 });
    const latencia = data.cards.find((c) => c.question === 'Define "latencia"');
    assert.equal(latencia.answer, 'Tiempo de ida, en ms');
    assert.ok(data.cards.find((c) => c.question === 'Pregunta con\nsalto de línea'));
    assert.deepEqual(data.cards.find((c) => c.answer === '62').wrongs, ['64', '30', '126']);
    assert.deepEqual(data.folders.map((f) => f.name).sort(), ['Redes', 'SQL']);
  });

  test('reimportar reutiliza las carpetas que ya existen', async () => {
    const res = await luis.post('/api/import', { csv: 'Otra,Más,,,,redes' });
    assert.equal(res.data.folders_created, 0);
  });

  test('exporta en el mismo formato y se puede volver a importar igual', async () => {
    const res = await luis.get('/api/export.csv', { raw: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-type'), /text\/csv/);
    assert.match(res.data, /"Define ""latencia""","Tiempo de ida, en ms",,,,Redes/);
    assert.match(res.data, /"Pregunta con\nsalto de línea",Respuesta,,,,SQL/);
  });

  test('un CSV sin tarjetas válidas da un error claro', async () => {
    const res = await luis.post('/api/import', { csv: ',sin pregunta\n' });
    assert.equal(res.status, 400);
    assert.match(res.data.error, /pregunta y respuesta/);
  });
});

describe('estadísticas', () => {
  let app;
  let luis;
  before(async () => {
    app = await startServer();
    const admin = await adminClient(app);
    luis = await invitedClient(app, admin, 'luis@x.test');
    await luis.post('/api/sync', {
      since: 0,
      changes: {
        folders: [{ id: 'redes', name: 'Redes' }, { id: 'sql', name: 'SQL' }],
        cards: [
          { id: 'facil', folder_id: 'sql', question: 'SELECT', answer: 'lee' },
          { id: 'dificil', folder_id: 'redes', question: '/26', answer: '62' },
        ],
      },
    });
    const t = app.clock.t;
    const reviews = [];
    // Hoy, ayer y anteayer: 3 días seguidos. Hace 5 días, uno suelto.
    for (const [daysAgo, card, correct] of [
      [0, 'facil', true], [0, 'dificil', false], [1, 'dificil', false],
      [2, 'dificil', true], [2, 'facil', true], [5, 'dificil', false],
    ]) {
      reviews.push({ id: `r${reviews.length}`, card_id: card, correct, mode: 'quiz', answered_at: t - daysAgo * DAY });
    }
    await luis.post('/api/sync', { since: 0, changes: { reviews } });
  });
  after(() => app.close());

  test('racha, actividad, aciertos por carpeta y tarjetas flojas', async () => {
    const { status, data } = await luis.get('/api/stats?tz=Europe/Madrid');
    assert.equal(status, 200);
    assert.equal(data.streak, 3);
    assert.equal(data.heatmap.length, 84);
    assert.equal(data.heatmap.at(-1).count, 2, 'hoy, 2 respuestas');
    assert.equal(data.month.answers, 6);
    assert.equal(data.month.accuracy, 3 / 6);
    const sql = data.folders.find((f) => f.name === 'SQL');
    const redes = data.folders.find((f) => f.name === 'Redes');
    assert.equal(sql.accuracy, 1);
    assert.equal(redes.accuracy, 1 / 4);
    assert.deepEqual(data.weak.map((w) => w.card_id), ['dificil']);
    assert.equal(data.cards.dificil.last, '0100', 'de la más antigua a la más reciente');
  });

  test('si hoy aún no ha estudiado, la racha cuenta hasta ayer', async () => {
    app.clock.t += DAY;
    const { data } = await luis.get('/api/stats');
    assert.equal(data.streak, 3);
    app.clock.t += DAY;
    const { data: rota } = await luis.get('/api/stats');
    assert.equal(rota.streak, 0);
    app.clock.t -= 2 * DAY;
  });

  test('una zona horaria inventada da error', async () => {
    assert.equal((await luis.get('/api/stats?tz=Marte/Olympus')).status, 400);
  });
});

describe('carpetas compartidas', () => {
  let app;
  let admin;
  let luis;
  let ana;
  let token;
  before(async () => {
    app = await startServer();
    admin = await adminClient(app);
    luis = await invitedClient(app, admin, 'luis@x.test', 'Luis');
    ana = await invitedClient(app, admin, 'ana@x.test', 'Ana');
    await luis.post('/api/sync', {
      since: 0,
      changes: {
        folders: [{ id: 'redes', name: 'Redes', color: '#3b5bdb' }],
        cards: [
          { id: 'a', folder_id: 'redes', question: '¿/26?', answer: '62', wrongs: ['64', '30', '126'] },
          { id: 'b', folder_id: 'redes', question: '¿SSH?', answer: '22' },
        ],
        reviews: [{ id: 'r', card_id: 'a', correct: true, mode: 'quiz', answered_at: app.clock.t }],
      },
    });
  });
  after(() => app.close());

  test('compartir una carpeta da un enlace', async () => {
    const res = await luis.post('/api/folders/redes/share', { mode: 'copy' });
    assert.equal(res.status, 200);
    assert.match(res.data.share.url, /^http:\/\/localhost:5173\/c\/[A-Za-z0-9_-]{16}$/);
    token = res.data.share.token;
  });

  test('cualquiera con el enlace ve las tarjetas, sin estadísticas ni correo', async () => {
    const res = await app.client().get(`/api/shared/${token}`);
    assert.equal(res.status, 200);
    assert.equal(res.data.owner, 'Luis');
    assert.equal(res.data.cards.length, 2);
    const texto = JSON.stringify(res.data);
    assert.doesNotMatch(texto, /luis@x\.test/);
    assert.doesNotMatch(texto, /attempts|correct|accuracy/);
  });

  test('Ana se hace una copia independiente', async () => {
    const res = await ana.post(`/api/shared/${token}/copy`);
    assert.equal(res.status, 200);
    assert.equal(res.data.cards, 2);
    const { data } = await ana.post('/api/sync', { since: 0 });
    assert.equal(data.folders[0].source, 'Luis');
    assert.equal(data.cards.length, 2);
    assert.ok(data.cards.every((c) => !['a', 'b'].includes(c.id)), 'las copias tienen ids propios');

    // Lo que Luis cambie después no le llega a Ana
    await luis.post('/api/sync', { since: 0, changes: { cards: [{ id: 'a', folder_id: 'redes', question: 'cambiada', answer: '62' }] } });
    const { data: luego } = await ana.post('/api/sync', { since: 0 });
    assert.ok(!luego.cards.some((c) => c.question === 'cambiada'));
  });

  test('con un enlace de "solo ver" no se puede copiar', async () => {
    await luis.post('/api/folders/redes/share', { mode: 'view' });
    assert.equal((await ana.post(`/api/shared/${token}/copy`)).status, 403);
    assert.equal((await app.client().get(`/api/shared/${token}`)).status, 200, 'el enlace sigue siendo el mismo');
  });

  test('solo el dueño puede compartir su carpeta', async () => {
    assert.equal((await ana.post('/api/folders/redes/share', { mode: 'copy' })).status, 404);
  });

  test('al dejar de compartir, el enlace deja de funcionar', async () => {
    assert.equal((await luis.delete('/api/folders/redes/share')).status, 204);
    assert.equal((await app.client().get(`/api/shared/${token}`)).status, 404);
  });

  test('borrar la carpeta también deja de compartirla', async () => {
    const { data } = await luis.post('/api/folders/redes/share', { mode: 'copy' });
    await luis.post('/api/sync', { since: 0, changes: { folders: [{ id: 'redes', deleted: true }] } });
    assert.equal((await app.client().get(`/api/shared/${data.share.token}`)).status, 404);
  });
});
