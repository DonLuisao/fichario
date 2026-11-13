// Base de datos SQLite con el módulo que trae Node.
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS meta (
    key   TEXT PRIMARY KEY,
    value INTEGER NOT NULL
  );
  INSERT OR IGNORE INTO meta (key, value) VALUES ('rev', 0), ('schema', 1);

  CREATE TABLE IF NOT EXISTS users (
    id            TEXT PRIMARY KEY,
    email         TEXT NOT NULL UNIQUE,
    name          TEXT NOT NULL DEFAULT '',
    password_hash TEXT NOT NULL,
    is_admin      INTEGER NOT NULL DEFAULT 0,
    is_demo       INTEGER NOT NULL DEFAULT 0,
    created_at    INTEGER NOT NULL,
    last_login_at INTEGER
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token_hash   TEXT PRIMARY KEY,
    user_id      TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    expires_at   INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS invites (
    code       TEXT PRIMARY KEY,
    created_by TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    note       TEXT NOT NULL DEFAULT '',
    used_by    TEXT REFERENCES users(id) ON DELETE SET NULL,
    used_at    INTEGER
  );

  CREATE TABLE IF NOT EXISTS password_resets (
    token_hash TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at INTEGER NOT NULL,
    expires_at INTEGER NOT NULL,
    used_at    INTEGER
  );

  -- rev: número de cambio global. El cliente pide "todo lo que tenga rev > el último que vi".
  CREATE TABLE IF NOT EXISTS folders (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name       TEXT NOT NULL,
    color      TEXT NOT NULL DEFAULT '',
    source     TEXT NOT NULL DEFAULT '',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    rev        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_folders_user_rev ON folders(user_id, rev);

  CREATE TABLE IF NOT EXISTS cards (
    id         TEXT PRIMARY KEY,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    folder_id  TEXT,
    question   TEXT NOT NULL,
    answer     TEXT NOT NULL,
    wrongs     TEXT NOT NULL DEFAULT '[]',
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    deleted    INTEGER NOT NULL DEFAULT 0,
    rev        INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_cards_user_rev ON cards(user_id, rev);

  -- Cada respuesta a una tarjeta. De aquí salen todas las estadísticas.
  CREATE TABLE IF NOT EXISTS reviews (
    id          TEXT PRIMARY KEY,
    user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    card_id     TEXT NOT NULL,
    correct     INTEGER NOT NULL,
    mode        TEXT NOT NULL,
    answered_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_reviews_user_time ON reviews(user_id, answered_at);
  CREATE INDEX IF NOT EXISTS idx_reviews_card ON reviews(card_id, answered_at);

  CREATE TABLE IF NOT EXISTS shares (
    token      TEXT PRIMARY KEY,
    folder_id  TEXT NOT NULL UNIQUE REFERENCES folders(id) ON DELETE CASCADE,
    user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    mode       TEXT NOT NULL CHECK (mode IN ('view', 'copy')),
    created_at INTEGER NOT NULL
  );
`;

export function openDb(path) {
  if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
  db.exec(SCHEMA);

  const bump = db.prepare("UPDATE meta SET value = value + 1 WHERE key = 'rev' RETURNING value");
  const current = db.prepare("SELECT value FROM meta WHERE key = 'rev'");

  return {
    raw: db,
    prepare: (sql) => db.prepare(sql),
    exec: (sql) => db.exec(sql),
    nextRev: () => Number(bump.get().value),
    currentRev: () => Number(current.get().value),
    // Ejecuta fn dentro de una transacción; si lanza un error, se deshace todo.
    transaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const result = fn();
        db.exec('COMMIT');
        return result;
      } catch (error) {
        db.exec('ROLLBACK');
        throw error;
      }
    },
    close: () => db.close(),
  };
}
