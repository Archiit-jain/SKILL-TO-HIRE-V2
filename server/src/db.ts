import { mkdirSync } from "node:fs";
import path from "node:path";
import { createClient, type Client, type InArgs, type InValue, type Transaction } from "@libsql/client";
import { config } from "./config.js";

/**
 * Database access (hackathon release: persistent storage).
 *
 * One code path for every environment, through @libsql/client:
 *  - production/preview on Vercel: a hosted libSQL database (Turso) from TURSO_DATABASE_URL + TURSO_AUTH_TOKEN, which
 *    persists across serverless instances and deployments;
 *  - local development: a SQLite file (server/data/skill2hire.db by default);
 *  - tests: a private in-memory database per app (migration tests also use temporary files).
 * Without TURSO_DATABASE_URL on Vercel the app still starts on /tmp storage, which is NOT persistent; `db.persistent` is
 * then false and the frontend banner says so (`persistentStorage` in GET /api/auth/providers).
 *
 * Operations on one Db are serialised in-process: libSQL's local driver can't run overlapping transactions on one
 * connection, and serialising keeps multi-statement checks (guest free use, quotas) atomic within an instance.
 * Transactions (`db.transaction`) provide atomicity across instances on the hosted database.
 */

export type Row = Record<string, unknown>;

export interface Queryable {
  get<T = Row>(sql: string, ...args: InValue[]): Promise<T | undefined>;
  all<T = Row>(sql: string, ...args: InValue[]): Promise<T[]>;
  run(sql: string, ...args: InValue[]): Promise<{ changes: number }>;
}

export interface Db extends Queryable {
  /** Runs several statements separated by semicolons (schema scripts). */
  exec(sql: string): Promise<void>;
  /** Runs `fn` in one write transaction; rolls back if it throws. */
  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T>;
  /** False for in-memory databases and for the Vercel /tmp fallback, whose data is lost when the instance is recycled. */
  readonly persistent: boolean;
  close(): void;
}

/**
 * Ordered migrations. `schema_version` records how many have run, so each runs exactly once per database.
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

type Executor = Client | Transaction;

const toPlain = (columns: string[], row: ArrayLike<unknown>): Row =>
  Object.fromEntries(columns.map((c, i) => [c, row[i]]));

function queryable(exec: () => Executor): Queryable {
  const run = async (sql: string, args: InValue[]) => exec().execute({ sql, args: args as InArgs });
  return {
    async get<T>(sql: string, ...args: InValue[]) {
      const r = await run(sql, args);
      return (r.rows[0] ? toPlain(r.columns, r.rows[0]) : undefined) as T | undefined;
    },
    async all<T>(sql: string, ...args: InValue[]) {
      const r = await run(sql, args);
      return r.rows.map((row) => toPlain(r.columns, row)) as T[];
    },
    async run(sql: string, ...args: InValue[]) {
      const r = await run(sql, args);
      return { changes: r.rowsAffected };
    },
  };
}

class LibsqlDb implements Db {
  private tail: Promise<unknown> = Promise.resolve();
  private readonly direct: Queryable;

  constructor(
    private readonly client: Client,
    readonly persistent: boolean
  ) {
    this.direct = queryable(() => this.client);
  }

  /** Queues `fn` behind every earlier operation on this Db. */
  private serial<T>(fn: () => Promise<T>): Promise<T> {
    const result = this.tail.then(fn, fn);
    this.tail = result.catch(() => undefined);
    return result;
  }

  get<T = Row>(sql: string, ...args: InValue[]) {
    return this.serial(() => this.direct.get<T>(sql, ...args));
  }

  all<T = Row>(sql: string, ...args: InValue[]) {
    return this.serial(() => this.direct.all<T>(sql, ...args));
  }

  run(sql: string, ...args: InValue[]) {
    return this.serial(() => this.direct.run(sql, ...args));
  }

  exec(sql: string) {
    return this.serial(() => this.client.executeMultiple(sql));
  }

  transaction<T>(fn: (tx: Queryable) => Promise<T>): Promise<T> {
    return this.serial(async () => {
      const tx = await this.client.transaction("write");
      try {
        const result = await fn(queryable(() => tx));
        await tx.commit();
        return result;
      } catch (err) {
        await tx.rollback().catch(() => undefined);
        throw err;
      } finally {
        tx.close();
      }
    });
  }

  close() {
    this.client.close();
  }
}

/** Current schema version. `schema_version` replaces PRAGMA user_version (not every hosted libSQL server allows it);
 * a local database created before this release is seeded from its user_version so no migration runs twice. */
async function currentVersion(db: Db): Promise<number> {
  await db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = await db.get<{ version: number }>("SELECT version FROM schema_version LIMIT 1");
  if (row) return Number(row.version);
  let legacy = 0;
  try {
    legacy = Number((await db.get<{ user_version: number }>("PRAGMA user_version"))?.user_version ?? 0);
  } catch {
    legacy = 0;
  }
  await db.run("INSERT INTO schema_version (version) VALUES (?)", legacy);
  return legacy;
}

/** Applies migrations after the current version up to `upTo`, each in its own transaction. */
export async function migrateTo(db: Db, upTo = MIGRATIONS.length) {
  const current = await currentVersion(db);
  for (let i = current; i < upTo; i++) {
    await db.transaction(async (tx) => {
      for (const statement of splitStatements(MIGRATIONS[i])) await tx.run(statement);
      await tx.run("UPDATE schema_version SET version = ?", i + 1);
    });
  }
}

/** Splits a migration script into statements (the scripts contain no semicolons inside strings or triggers). */
export function splitStatements(script: string): string[] {
  return script
    .split("\n")
    .map((line) => line.replace(/--.*$/, ""))
    .join("\n")
    .split(";")
    .map((s) => s.trim())
    .filter(Boolean);
}

export interface OpenDbOptions {
  /** libsql://…, file:…, or a plain file path. */
  url?: string;
  authToken?: string;
  /** Apply migrations up to this version (tests); default: all. */
  migrateUpTo?: number;
  /** Data is lost when the instance is recycled; default: the configured database's setting. */
  ephemeral?: boolean;
}

/** Opens (and migrates) the application database. */
export async function openDb(options: OpenDbOptions = {}): Promise<Db> {
  const url = options.url ?? config.database.url;
  const authToken = options.authToken ?? config.database.authToken;
  const remote = /^(libsql|https?|wss?):/i.test(url);
  let clientUrl = url;
  if (!remote && url !== ":memory:") {
    const file = url.replace(/^file:/i, "");
    mkdirSync(path.dirname(file), { recursive: true });
    clientUrl = `file:${file}`;
  }
  const client = createClient({ url: clientUrl, authToken: remote ? authToken : undefined, intMode: "number" });
  const ephemeral = options.ephemeral ?? (options.url === undefined && config.database.ephemeral);
  const db = new LibsqlDb(client, url !== ":memory:" && !ephemeral);
  try {
    if (!remote) {
      await db.exec("PRAGMA foreign_keys = ON");
      if (url !== ":memory:") await db.exec("PRAGMA journal_mode = WAL");
    }
    await migrateTo(db, options.migrateUpTo);
  } catch (err) {
    db.close(); // the failed migration was rolled back; don't leave the file handle open
    throw err;
  }
  return db;
}
