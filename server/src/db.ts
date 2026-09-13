import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { config } from "./config.js";

export type Db = DatabaseSync;

const SCHEMA = `
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
`;

export function openDb(file = config.databasePath): Db {
  if (file !== ":memory:") mkdirSync(path.dirname(file), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec("PRAGMA foreign_keys = ON;");
  if (file !== ":memory:") db.exec("PRAGMA journal_mode = WAL;");
  db.exec(SCHEMA);
  return db;
}
