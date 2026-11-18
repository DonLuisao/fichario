import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { adminClient, DAY, invitedClient, startServer } from './helpers.mjs';
import { openDb } from '../src/db.mjs';
import { startBackups } from '../src/backup.mjs';

describe('mi cuenta', () => {
  let app;
  let admin;
  let luis;
  before(async () => {
    app = await startServer();
    admin = await adminClient(app);
    luis = await invitedClient(app, admin, 'luis@x.test', 'Luis');
    await luis.post('/api/sync', {
      since: 0,
      changes: {
        folders: [{ id: 'redes', name: 'Redes' }],
        cards: [{ id: 'c1', folder_id: 'redes', question: '¿/26?', answer: '62', wrongs: ['64'] }],
        reviews: [{ id: 'r1', card_id: 'c1', correct: true, mode: 'quiz', answered_at: app.clock.t }],
      },
    });
    await luis.post('/api/folders/redes/share', { mode: 'copy' });
  });
  after(() => app.close());

  test('descargar todos mis datos, sin la contraseña', async () => {
    const res = await luis.get('/api/account/export', { raw: true });
    assert.equal(res.status, 200);
    assert.match(res.headers.get('content-disposition'), /attachment/);
    const data = JSON.parse(res.data);
    assert.equal(data.user.email, 'luis@x.test');
    assert.equal(data.cards[0].question, '¿/26?');
    assert.equal(data.reviews.length, 1);
    assert.equal(data.shares.length, 1);
    assert.doesNotMatch(res.data, /scrypt|password/);
  });

  test('borrar la cuenta pide la contraseña y se lleva todo', async () => {
    const { data: share } = await luis.get('/api/folders/redes/share');
    assert.equal((await luis.post('/api/account/delete', { password: 'equivocada' })).status, 400);
    assert.equal((await luis.post('/api/account/delete', { password: 'contraseña-larga' })).status, 204);
    assert.equal((await luis.get('/api/auth/me')).status, 401);
    assert.equal((await app.client().get(`/api/shared/${share.share.token}`)).status, 404);
    for (const table of ['folders', 'cards', 'reviews', 'sessions']) {
      const n = app.db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id NOT IN (SELECT id FROM users)`).get().n;
      assert.equal(n, 0, `no quedan restos en ${table}`);
    }
    const login = await app.client().post('/api/auth/login', { email: 'luis@x.test', password: 'contraseña-larga' });
    assert.equal(login.status, 401);
  });

  test('el admin no puede borrarse a sí mismo', async () => {
    assert.equal((await admin.post('/api/account/delete', { password: 'contraseña-admin' })).status, 400);
  });
});

describe('copias de seguridad', () => {
  test('crea una copia al día, que se puede abrir, y guarda solo las últimas', () => {
    const dir = mkdtempSync(join(tmpdir(), 'repaso-copias-'));
    const dbPath = join(dir, 'origen.db');
    const db = openDb(dbPath);
    db.exec("INSERT INTO users (id, email, password_hash, created_at) VALUES ('u', 'a@b.c', 'x', 0)");
    // Copias viejas de días anteriores
    for (let d = 1; d <= 5; d++) writeFileSync(join(dir, `repaso-2026-10-0${d}.db`), '');
    let t = Date.UTC(2026, 10, 13, 3, 0, 0);
    const silent = { log() {}, error() {} };
    const backups = startBackups({ db: db.raw, dir, keep: 3, now: () => t, log: silent });
    const first = join(dir, 'repaso-2026-11-13.db');
    assert.ok(existsSync(first));
    const copy = new DatabaseSync(first, { readOnly: true });
    assert.equal(copy.prepare('SELECT email FROM users').get().email, 'a@b.c');
    copy.close();

    t += DAY;
    backups.run();
    backups.stop();
    const left = readdirSync(dir).filter((f) => f.startsWith('repaso-')).sort();
    assert.deepEqual(left, ['repaso-2026-10-05.db', 'repaso-2026-11-13.db', 'repaso-2026-11-14.db']);
    db.close();
  });
});
