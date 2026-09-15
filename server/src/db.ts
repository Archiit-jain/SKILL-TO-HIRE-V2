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
  // 3 - security remediation P1: guest data lifecycle (D-6), server-side sessions (D-7), Gemini quotas (D-9).
  //     Timestamps are UTC ISO-8601 strings (Date#toISOString, so they sort correctly as text); quota days are
  //     UTC calendar days "YYYY-MM-DD".
  `
  -- D-6: "this browser has used its free analysis" marker, kept apart from any analysis content.
  CREATE TABLE guest_free_use (
    guest_id        TEXT PRIMARY KEY,
    used_at         TEXT NOT NULL
  );
  CREATE INDEX idx_guest_free_use_used_at ON guest_free_use(used_at);

  -- Backfill markers BEFORE deleting claimed rows, so every browser that already used its free analysis keeps
  -- counting as used.
  INSERT OR IGNORE INTO guest_free_use (guest_id, used_at)
    SELECT guest_id, MIN(created_at) FROM guest_analyses GROUP BY guest_id;

  -- Content already copied into an account must not survive outside it (H-2). claimed_by stays as a column but is
  -- no longer used: claimed rows are deleted when they are transferred.
  DELETE FROM guest_analyses WHERE claimed_by IS NOT NULL;
  CREATE INDEX idx_guest_analyses_created ON guest_analyses(created_at);

  -- D-7: one row per signed-in device; the JWT's jti is the row id.
  CREATE TABLE sessions (
    id              TEXT PRIMARY KEY,
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL
  );
  CREATE INDEX idx_sessions_user ON sessions(user_id);
  CREATE INDEX idx_sessions_expires ON sessions(expires_at);

  -- D-9: Gemini answers used per user per UTC day, and across all users per UTC day.
  CREATE TABLE assistant_usage (
    user_id         TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    day             TEXT NOT NULL,
    count           INTEGER NOT NULL CHECK (count >= 0),
    PRIMARY KEY (user_id, day)
  );
  CREATE TABLE assistant_usage_global (
    day             TEXT PRIMARY KEY,
    count           INTEGER NOT NULL CHECK (count >= 0)
  );
  `,
];

/** Exported for migration tests only. */
export const MIGRATION_COUNT = MIGRATIONS.length;

/** Applies migrations 1..`upTo` to a raw database (tests use this to build an older schema version). */
export function migrateTo(db: Db, upTo: number) {
  migrate(db, upTo);
}

function migrate(db: Db, upTo = MIGRATIONS.length) {
  const current = (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
  for (let i = current; i < upTo; i++) {
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
  try {
    migrate(db);
  } catch (err) {
    db.close(); // the failed migration was rolled back; don't leave the file handle open
    throw err;
  }
  return db;
}
