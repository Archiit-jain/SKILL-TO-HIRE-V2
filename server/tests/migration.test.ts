// Schema migrations on the libSQL data layer: migration 3 (security remediation P1) and the schema_version tracking
// added with persistent storage. Uses throwaway SQLite files in the OS temp directory; nothing touches server/data.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { MIGRATION_COUNT, openDb, splitStatements, type Db } from "../src/db.js";

const dir = mkdtempSync(path.join(tmpdir(), "s2h-migration-"));
after(() => {
  // libSQL releases file handles asynchronously; on Windows a just-closed database can briefly stay locked. The OS
  // temp directory is cleaned up eventually, so a still-locked file is not a test failure.
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== "EPERM" && (err as NodeJS.ErrnoException).code !== "EBUSY") throw err;
  }
});
let fileNo = 0;
const tempFile = () => path.join(dir, `db-${++fileNo}.db`);

const version = async (db: Db) => Number((await db.get<{ version: number }>("SELECT version FROM schema_version"))!.version);
const tables = async (db: Db) =>
  (await db.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")).map((r) => r.name);
const indexes = async (db: Db, table: string) => (await db.all<{ name: string }>(`PRAGMA index_list(${table})`)).map((r) => r.name);
const columns = async (db: Db, table: string) =>
  (await db.all<{ name: string; type: string; notnull: number; pk: number }>(`PRAGMA table_info(${table})`)).map(
    (c) => `${c.name}:${c.type}:${c.notnull ? "notnull" : "null"}:pk${c.pk}`
  );
const foreignKeys = async (db: Db, table: string) =>
  (await db.all<{ table: string; from: string; to: string; on_delete: string }>(`PRAGMA foreign_key_list(${table})`)).map(
    (f) => `${f.from}->${f.table}.${f.to} ${f.on_delete}`
  );
const count = async (db: Db, sql: string, ...params: Array<string | number>) => Number((await db.get<{ n: number }>(sql, ...params))!.n);

async function insertUser(db: Db, id: string) {
  await db.run(
    "INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
    id, "Synthetic User", `${id}@example.com`, "!", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
}

/** A database file at schema version 2 (the released pre-P1 schema) with representative synthetic rows. */
async function v2Database(file: string) {
  const db = await openDb({ url: file, migrateUpTo: 2 });
  assert.equal(await version(db), 2);
  await insertUser(db, "u1");
  await insertUser(db, "u2");
  await db.run(`INSERT INTO analyses (id, user_id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, result_json, created_at)
    VALUES ('a1', 'u1', 'resume.pdf', 'Data Engineer', 50, 1, 1, 1, '{}', '2026-02-01T00:00:00.000Z')`);
  const guest = "INSERT INTO guest_analyses (id, guest_id, result_json, claimed_by, created_at) VALUES (?, ?, ?, ?, ?)";
  await db.run(guest, "g-claimed", "guest-a", '{"evidence":"claimed content"}', "u1", "2026-03-01T10:00:00.000Z");
  await db.run(guest, "g-unclaimed", "guest-b", '{"evidence":"unclaimed content"}', null, "2026-03-02T10:00:00.000Z");
  // Two rows for one browser (possible before P1: a claimed row plus a later one): marker must use the EARLIEST time.
  await db.run(guest, "g-c1", "guest-c", "{}", "u2", "2026-03-03T10:00:00.000Z");
  await db.run(guest, "g-c2", "guest-c", "{}", null, "2026-03-04T10:00:00.000Z");
  db.close();
}

async function assertUpgradedFromV2(db: Db) {
  assert.equal(await version(db), 3);
  const markers = await db.all("SELECT guest_id, used_at FROM guest_free_use ORDER BY guest_id");
  assert.deepEqual(markers, [
    { guest_id: "guest-a", used_at: "2026-03-01T10:00:00.000Z" }, // marker kept although its only row was claimed
    { guest_id: "guest-b", used_at: "2026-03-02T10:00:00.000Z" },
    { guest_id: "guest-c", used_at: "2026-03-03T10:00:00.000Z" }, // earliest of its rows
  ]);
  const remaining = (await db.all<{ id: string }>("SELECT id FROM guest_analyses ORDER BY id")).map((r) => r.id);
  assert.deepEqual(remaining, ["g-c2", "g-unclaimed"], "claimed rows are gone, unclaimed rows stay");
  // Existing data outside guest_analyses is untouched.
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM users"), 2);
  assert.equal(await count(db, "SELECT COUNT(*) AS n FROM analyses"), 1);
  for (const t of ["sessions", "assistant_usage", "assistant_usage_global"]) assert.equal(await count(db, `SELECT COUNT(*) AS n FROM ${t}`), 0, t);
}

describe("migration 3", () => {
  it("brings a fresh database to the latest version with the new tables, columns, keys and indexes", async () => {
    const db = await openDb({ url: ":memory:" });
    assert.equal(MIGRATION_COUNT, 3);
    assert.equal(await version(db), 3);
    const all = await tables(db);
    for (const t of ["guest_free_use", "sessions", "assistant_usage", "assistant_usage_global", "schema_version"]) assert.ok(all.includes(t), t);

    assert.deepEqual(await columns(db, "guest_free_use"), ["guest_id:TEXT:null:pk1", "used_at:TEXT:notnull:pk0"]);
    assert.deepEqual(await columns(db, "sessions"), ["id:TEXT:null:pk1", "user_id:TEXT:notnull:pk0", "created_at:TEXT:notnull:pk0", "expires_at:TEXT:notnull:pk0"]);
    assert.deepEqual(await columns(db, "assistant_usage"), ["user_id:TEXT:notnull:pk1", "day:TEXT:notnull:pk2", "count:INTEGER:notnull:pk0"]);
    assert.deepEqual(await columns(db, "assistant_usage_global"), ["day:TEXT:null:pk1", "count:INTEGER:notnull:pk0"]);

    assert.deepEqual(await foreignKeys(db, "sessions"), ["user_id->users.id CASCADE"]);
    assert.deepEqual(await foreignKeys(db, "assistant_usage"), ["user_id->users.id CASCADE"]);
    assert.deepEqual(await foreignKeys(db, "guest_free_use"), [], "the marker is not linked to any account");

    assert.ok((await indexes(db, "guest_free_use")).includes("idx_guest_free_use_used_at"));
    assert.ok((await indexes(db, "guest_analyses")).includes("idx_guest_analyses_created"));
    assert.ok((await indexes(db, "sessions")).includes("idx_sessions_user"));
    assert.ok((await indexes(db, "sessions")).includes("idx_sessions_expires"));
    db.close();
  });

  it("upgrades an existing v2 database: markers backfilled first, then claimed guest content deleted", async () => {
    const file = tempFile();
    await v2Database(file);
    const db = await openDb({ url: file });
    await assertUpgradedFromV2(db);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE result_json LIKE '%claimed content%' AND id = 'g-claimed'"), 0);
    db.close();
  });

  it("upgrades a local database created before schema_version existed (version read from PRAGMA user_version)", async () => {
    const file = tempFile();
    await v2Database(file);
    // Turn it into what the previous node:sqlite runner left behind: user_version = 2 and no schema_version table.
    const raw = new DatabaseSync(file);
    raw.exec("DROP TABLE schema_version; PRAGMA user_version = 2;");
    raw.close();
    const db = await openDb({ url: file });
    await assertUpgradedFromV2(db); // migration 2 was not re-run (it would fail on its existing tables) and 3 ran once
    db.close();
  });

  it("runs exactly once: reopening a v3 database changes nothing", async () => {
    const file = tempFile();
    await v2Database(file);
    (await openDb({ url: file })).close();

    const db = await openDb({ url: file });
    // Rows written after the upgrade (including a claimed guest row) must survive another open.
    await db.run("INSERT INTO guest_analyses (id, guest_id, result_json, claimed_by, created_at) VALUES ('g-later', 'guest-d', '{}', 'u1', '2026-04-01T00:00:00.000Z')");
    db.close();

    const again = await openDb({ url: file });
    assert.equal(await version(again), 3);
    assert.equal(await count(again, "SELECT COUNT(*) AS n FROM guest_analyses WHERE id = 'g-later'"), 1);
    assert.equal(await count(again, "SELECT COUNT(*) AS n FROM guest_free_use"), 3, "backfill did not run again");
    assert.equal(await count(again, "SELECT COUNT(*) AS n FROM schema_version"), 1);
    again.close();
  });

  it("rolls back and stays at the old version if the migration fails", async () => {
    const file = tempFile();
    await v2Database(file);
    const raw = new DatabaseSync(file);
    raw.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)"); // conflicts with migration 3
    raw.close();
    await assert.rejects(() => openDb({ url: file }), /sessions already exists/);
    const check = await openDb({ url: file, migrateUpTo: 2 });
    assert.equal(await version(check), 2);
    assert.ok(!(await tables(check)).includes("guest_free_use"), "nothing from the failed migration was kept");
    assert.equal(await count(check, "SELECT COUNT(*) AS n FROM guest_analyses"), 4, "no guest row was deleted");
    check.close();
  });

  it("cascades session and quota rows when an account is deleted, and enforces keys and checks", async () => {
    const db = await openDb({ url: ":memory:" });
    await insertUser(db, "u1");
    await insertUser(db, "u2");
    const session = (...args: string[]) => db.run("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)", ...args);
    const usage = (userId: string, day: string, n: number) => db.run("INSERT INTO assistant_usage (user_id, day, count) VALUES (?, ?, ?)", userId, day, n);
    await session("jti-1", "u1", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
    await session("jti-2", "u1", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
    await session("jti-3", "u2", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
    await usage("u1", "2026-09-14", 3);
    await usage("u2", "2026-09-14", 1);
    await db.run("INSERT INTO assistant_usage_global (day, count) VALUES ('2026-09-14', 4)");
    await db.run("INSERT INTO guest_free_use (guest_id, used_at) VALUES ('guest-x', '2026-09-14T00:00:00.000Z')");

    await db.run("DELETE FROM users WHERE id = 'u1'");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'u1'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM assistant_usage WHERE user_id = 'u1'"), 0);
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM sessions"), 1, "other users' sessions are untouched");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM assistant_usage_global"), 1, "global counter is not per-user data");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM guest_free_use"), 1);

    await assert.rejects(() => session("jti-4", "nobody", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z"), /FOREIGN KEY/);
    await assert.rejects(() => session("jti-3", "u2", "x", "y"), /UNIQUE|PRIMARY KEY/);
    await assert.rejects(() => usage("u2", "2026-09-14", 5), /UNIQUE|PRIMARY KEY/);
    await assert.rejects(() => usage("u2", "2026-09-15", -1), /CHECK/);
    await assert.rejects(() => db.run("INSERT INTO guest_free_use (guest_id, used_at) VALUES ('guest-x', 'x')"), /UNIQUE|PRIMARY KEY/);
    db.close();
  });
});

describe("data layer", () => {
  it("splits migration scripts into statements, ignoring comments", () => {
    assert.deepEqual(splitStatements("-- a comment; with a semicolon\nCREATE TABLE a (x INT);\n\n  DELETE FROM a; -- trailing\n"), [
      "CREATE TABLE a (x INT)",
      "DELETE FROM a",
    ]);
  });

  it("rolls back a failed transaction and keeps serving later operations", async () => {
    const db = await openDb({ url: ":memory:" });
    await assert.rejects(
      db.transaction(async (tx) => {
        await tx.run("INSERT INTO guest_free_use (guest_id, used_at) VALUES ('g1', 'now')");
        throw new Error("boom");
      }),
      /boom/
    );
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM guest_free_use"), 0);
    await db.run("INSERT INTO guest_free_use (guest_id, used_at) VALUES ('g2', 'now')");
    assert.equal(await count(db, "SELECT COUNT(*) AS n FROM guest_free_use"), 1);
    db.close();
  });

  it("serialises concurrent transactions on one database without lost updates", async () => {
    const db = await openDb({ url: ":memory:" });
    await db.run("INSERT INTO assistant_usage_global (day, count) VALUES ('d', 0)");
    await Promise.all(
      Array.from({ length: 25 }, () =>
        db.transaction(async (tx) => {
          const n = Number((await tx.get<{ count: number }>("SELECT count FROM assistant_usage_global WHERE day = 'd'"))!.count);
          await tx.run("UPDATE assistant_usage_global SET count = ? WHERE day = 'd'", n + 1);
        })
      )
    );
    assert.equal(await count(db, "SELECT count AS n FROM assistant_usage_global WHERE day = 'd'"), 25);
    db.close();
  });

  it("returns plain row objects and numbers for integer columns", async () => {
    const db = await openDb({ url: ":memory:" });
    await db.run("INSERT INTO assistant_usage_global (day, count) VALUES ('d', 7)");
    const row = await db.get<{ day: string; count: number }>("SELECT day, count FROM assistant_usage_global");
    assert.deepEqual(row, { day: "d", count: 7 });
    assert.equal(await db.get("SELECT day FROM assistant_usage_global WHERE day = 'none'"), undefined);
    db.close();
  });
});
