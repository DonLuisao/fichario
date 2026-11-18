import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { adminClient, invitedClient, startServer } from './helpers.mjs';

describe('sincronización', () => {
  let app;
  let admin;
  let movil;
  let portatil;
  let rev = 0;
  before(async () => {
    app = await startServer();
    admin = await adminClient(app);
    movil = await invitedClient(app, admin, 'luis@x.test');
    portatil = app.client();
    await portatil.post('/api/auth/login', { email: 'luis@x.test', password: 'contraseña-larga' });
  });
  after(() => app.close());

  test('lo creado en un dispositivo aparece en el otro', async () => {
    const res = await movil.post('/api/sync', {
      since: 0,
      changes: {
        folders: [{ id: 'f-redes', name: 'Redes', color: '#3B5BDB' }],
        cards: [
          { id: 'c1', folder_id: 'f-redes', question: '¿Hosts en un /26?', answer: '62', wrongs: ['64', '30', '126'] },
          { id: 'c2', folder_id: 'f-redes', question: '¿Puerto de SSH?', answer: '22' },
        ],
      },
    });
    assert.equal(res.status, 200);
    assert.equal(res.data.cards.length, 2);
    assert.equal(res.data.folders[0].color, '#3b5bdb');

    const otro = await portatil.post('/api/sync', { since: 0 });
    assert.deepEqual(otro.data.cards.map((c) => c.id).sort(), ['c1', 'c2']);
    assert.deepEqual(otro.data.cards.find((c) => c.id === 'c1').wrongs, ['64', '30', '126']);
    rev = otro.data.rev;
  });

  test('después solo llega lo que ha cambiado', async () => {
    await movil.post('/api/sync', { since: rev, changes: { cards: [{ id: 'c2', folder_id: 'f-redes', question: '¿Puerto de SSH?', answer: '22/tcp' }] } });
    const res = await portatil.post('/api/sync', { since: rev });
    assert.equal(res.data.cards.length, 1);
    assert.equal(res.data.cards[0].answer, '22/tcp');
    assert.equal(res.data.folders.length, 0);
    rev = res.data.rev;
  });

  test('los borrados llegan como tombstones', async () => {
    await movil.post('/api/sync', { since: rev, changes: { cards: [{ id: 'c2', deleted: true }] } });
    const res = await portatil.post('/api/sync', { since: rev });
    assert.deepEqual(res.data.cards.map((c) => [c.id, c.deleted]), [['c2', true]]);
    rev = res.data.rev;
  });

  test('borrar una carpeta borra sus tarjetas', async () => {
    await movil.post('/api/sync', { since: rev, changes: { folders: [{ id: 'f-redes', deleted: true }] } });
    const res = await portatil.post('/api/sync', { since: rev });
    assert.equal(res.data.folders[0].deleted, true);
    assert.deepEqual(res.data.cards.map((c) => [c.id, c.deleted]), [['c1', true]]);
  });

  test('nadie puede sobrescribir las tarjetas de otro aunque conozca su id', async () => {
    await movil.post('/api/sync', { since: 0, changes: { cards: [{ id: 'privada', question: 'mía', answer: 'mía' }] } });
    const ana = await invitedClient(app, admin, 'ana@x.test');
    const ataque = await ana.post('/api/sync', { since: 0, changes: { cards: [{ id: 'privada', question: 'hackeada', answer: 'x' }] } });
    assert.equal(ataque.status, 200);
    assert.equal(ataque.data.cards.length, 0, 'Ana no recibe ni ve la tarjeta de Luis');
    const mia = await movil.post('/api/sync', { since: 0 });
    assert.equal(mia.data.cards.find((c) => c.id === 'privada').question, 'mía');
  });

  test('una tarjeta no puede apuntar a la carpeta de otro', async () => {
    const ana = app.client();
    await ana.post('/api/auth/login', { email: 'ana@x.test', password: 'contraseña-larga' });
    await movil.post('/api/sync', { since: 0, changes: { folders: [{ id: 'f-luis', name: 'De Luis' }] } });
    const res = await ana.post('/api/sync', { since: 0, changes: { cards: [{ id: 'c-ana', folder_id: 'f-luis', question: 'p', answer: 'r' }] } });
    assert.equal(res.data.cards.find((c) => c.id === 'c-ana').folder_id, null);
  });

  test('los datos no válidos se rechazan enteros', async () => {
    const before = await movil.post('/api/sync', { since: 0 });
    const res = await movil.post('/api/sync', {
      since: 0,
      changes: { cards: [{ id: 'ok-1', question: 'bien', answer: 'bien' }, { id: 'mal id!', question: 'x', answer: 'y' }] },
    });
    assert.equal(res.status, 400);
    const after = await movil.post('/api/sync', { since: 0 });
    assert.equal(after.data.cards.length, before.data.cards.length, 'no se ha guardado ni la buena');
  });

  test('las respuestas se guardan una sola vez aunque se reenvíen', async () => {
    await movil.post('/api/sync', { since: 0, changes: { cards: [{ id: 'c-rev', question: 'p', answer: 'r' }] } });
    const review = { id: 'r-1', card_id: 'c-rev', correct: true, mode: 'quiz', answered_at: app.clock.t };
    await movil.post('/api/sync', { since: 0, changes: { reviews: [review] } });
    await movil.post('/api/sync', { since: 0, changes: { reviews: [review] } });
    const n = app.db.prepare("SELECT COUNT(*) AS n FROM reviews WHERE id = 'r-1'").get().n;
    assert.equal(n, 1);
  });

  test('la cuenta demo puede leer pero no guardar', async () => {
    const { data } = await admin.post('/api/admin/invites', { count: 1 });
    const demo = app.client();
    await demo.post('/api/auth/register', { email: 'demo@repaso.test', password: 'demo-1234', invite: data.codes[0] });
    const { data: users } = await admin.get('/api/admin/users');
    const demoUser = users.users.find((u) => u.email === 'demo@repaso.test');
    await admin.post(`/api/admin/users/${demoUser.id}/demo`, { is_demo: true });

    const visitante = app.client();
    const login = await visitante.post('/api/auth/demo');
    assert.equal(login.status, 200);
    assert.equal(login.data.user.is_demo, true);
    const res = await visitante.post('/api/sync', { since: 0, changes: { cards: [{ id: 'demo-c', question: 'p', answer: 'r' }] } });
    assert.equal(res.status, 200);
    assert.equal(res.data.cards.length, 0, 'no se ha guardado');
    assert.equal((await visitante.post('/api/import', { csv: 'p,r' })).status, 403);
  });
});
