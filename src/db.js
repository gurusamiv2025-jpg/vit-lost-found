const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT NOT NULL,
  reg_no        TEXT NOT NULL UNIQUE,
  email         TEXT NOT NULL UNIQUE,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS items (
  id                    INTEGER PRIMARY KEY AUTOINCREMENT,
  type                  TEXT NOT NULL CHECK (type IN ('lost', 'found')),
  title                 TEXT NOT NULL,
  description           TEXT NOT NULL,
  category              TEXT NOT NULL,
  venue                 TEXT NOT NULL,
  event_date            TEXT NOT NULL,
  verification_question TEXT NOT NULL,
  status                TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  reporter_id           INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  resolved_by           INTEGER REFERENCES users(id),
  resolved_at           TEXT,
  created_at            TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_items_feed ON items (status, type, created_at);

CREATE TABLE IF NOT EXISTS claims (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  item_id            INTEGER NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  claimant_id        INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  answer             TEXT NOT NULL,
  details            TEXT NOT NULL DEFAULT '',
  status             TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  decision_note      TEXT NOT NULL DEFAULT '',
  meetup_checkpoint  TEXT,
  meetup_time        TEXT,
  meetup_proposed_by INTEGER REFERENCES users(id),
  meetup_confirmed   INTEGER NOT NULL DEFAULT 0,
  created_at         TEXT NOT NULL DEFAULT (datetime('now')),
  decided_at         TEXT,
  UNIQUE (item_id, claimant_id)
);

CREATE TABLE IF NOT EXISTS messages (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  claim_id   INTEGER NOT NULL REFERENCES claims(id) ON DELETE CASCADE,
  sender_id  INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  body       TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_messages_claim ON messages (claim_id, id);
`;

function defaultPath() {
  return process.env.DB_PATH || path.join(__dirname, '..', 'data', 'lostfound.db');
}

function openDb(file = defaultPath()) {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(SCHEMA);
  return db;
}

module.exports = { openDb, defaultPath, SCHEMA };
