import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export type Db = DatabaseSync;

/**
 * Ordered migrations. PRAGMA user_version records how many have run, so each runs exactly once per database.
 * Never edit a released migration; append a new one.
 */
const MIGRATIONS: string[] = [
  // 1 - initial schema
  `
  CREATE TABLE IF NOT EXISTS users (
    id              TEXT PRIMARY KEY,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash   TEXT NOT NULL,
    token_version   INTEGER NOT NULL DEFAULT 0,
    privacy_mode    INTEGER NOT NULL DEFAULT 1,
    notifications   INTEGER NOT NULL DEFAULT 1,
    created_at      TEXT NOT NULL,
    updated_at      TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS analyses (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    resume_name     TEXT NOT NULL,
    jd_title        TEXT NOT NULL,
    overall_score   REAL NOT NULL,
    strong_count    INTEGER NOT NULL,
    partial_count   INTEGER NOT NULL,
    missing_count   INTEGER NOT NULL,
    result_json     TEXT NOT NULL,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_analyses_user_created ON analyses(user_id, created_at DESC);
  `,
  // 2 - email verification, Google sign-in, guest analyses
  `
  ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE users ADD COLUMN google_sub TEXT;
  CREATE UNIQUE INDEX idx_users_google_sub ON users(google_sub) WHERE google_sub IS NOT NULL;

  CREATE TABLE email_verifications (
    token_hash      TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    expires_at      INTEGER NOT NULL,
    created_at      INTEGER NOT NULL
  );
  CREATE INDEX idx_email_verifications_user ON email_verifications(user_id);

  CREATE TABLE guest_analyses (
    id              TEXT PRIMARY KEY,
    guest_id        TEXT NOT NULL,
    result_json     TEXT NOT NULL,
    claimed_by      TEXT REFERENCES users(id) ON DELETE SET NULL,
    created_at      TEXT NOT NULL
  );
  CREATE INDEX idx_guest_analyses_guest ON guest_analyses(guest_id);
  `,
];

function migrate(db: Db) {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let i = current; i < MIGRATIONS.length; i++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[i]);
      db.exec(`PRAGMA user_version = ${i + 1}`);
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function openDb(file = config.databasePath): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  migrate(db);
  return db;
}
