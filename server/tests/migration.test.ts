// Migration 3 (security remediation P1): guest_free_use, guest cleanup index, sessions, assistant usage quotas.
// Uses throwaway SQLite files in the OS temp directory; nothing touches server/data.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { after, describe, it } from "node:test";
import { MIGRATION_COUNT, migrateTo, openDb, type Db } from "../src/db.js";

const dir = mkdtempSync(path.join(tmpdir(), "s2h-migration-"));
after(() => rmSync(dir, { recursive: true, force: true }));
let fileNo = 0;
const tempFile = () => path.join(dir, `db-${++fileNo}.db`);

const version = (db: Db) => (db.prepare("PRAGMA user_version").get() as { user_version: number }).user_version;
const tables = (db: Db) =>
  (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name").all() as Array<{ name: string }>).map((r) => r.name);
const indexes = (db: Db, table: string) =>
  (db.prepare(`PRAGMA index_list(${table})`).all() as Array<{ name: string }>).map((r) => r.name);
const columns = (db: Db, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string; notnull: number; pk: number }>).map(
    (c) => `${c.name}:${c.type}:${c.notnull ? "notnull" : "null"}:pk${c.pk}`
  );
const foreignKeys = (db: Db, table: string) =>
  (db.prepare(`PRAGMA foreign_key_list(${table})`).all() as Array<{ table: string; from: string; to: string; on_delete: string }>).map(
    (f) => `${f.from}->${f.table}.${f.to} ${f.on_delete}`
  );
const count = (db: Db, sql: string, ...params: Array<string | number>) => (db.prepare(sql).get(...params) as { n: number }).n;

function insertUser(db: Db, id: string) {
  db.prepare("INSERT INTO users (id, name, email, password_hash, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)").run(
    id, "Synthetic User", `${id}@example.com`, "!", "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z"
  );
}

/** A database file at schema version 2 (the released pre-P1 schema) with representative synthetic rows. */
function v2Database(file: string) {
  const raw = new DatabaseSync(file);
  raw.exec("PRAGMA foreign_keys = ON;");
  migrateTo(raw, 2);
  assert.equal(version(raw), 2);
  insertUser(raw, "u1");
  insertUser(raw, "u2");
  raw.prepare(`INSERT INTO analyses (id, user_id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, result_json, created_at)
    VALUES ('a1', 'u1', 'resume.pdf', 'Data Engineer', 50, 1, 1, 1, '{}', '2026-02-01T00:00:00.000Z')`).run();
  const guest = raw.prepare("INSERT INTO guest_analyses (id, guest_id, result_json, claimed_by, created_at) VALUES (?, ?, ?, ?, ?)");
  guest.run("g-claimed", "guest-a", '{"evidence":"claimed content"}', "u1", "2026-03-01T10:00:00.000Z");
  guest.run("g-unclaimed", "guest-b", '{"evidence":"unclaimed content"}', null, "2026-03-02T10:00:00.000Z");
  // Two rows for one browser (possible before P1: a claimed row plus a later one): marker must use the EARLIEST time.
  guest.run("g-c1", "guest-c", "{}", "u2", "2026-03-03T10:00:00.000Z");
  guest.run("g-c2", "guest-c", "{}", null, "2026-03-04T10:00:00.000Z");
  raw.close();
}

describe("migration 3", () => {
  it("brings a fresh database to the latest version with the new tables, columns, keys and indexes", () => {
    const db = openDb(":memory:");
    assert.equal(MIGRATION_COUNT, 3);
    assert.equal(version(db), 3);
    for (const t of ["guest_free_use", "sessions", "assistant_usage", "assistant_usage_global"]) assert.ok(tables(db).includes(t), t);

    assert.deepEqual(columns(db, "guest_free_use"), ["guest_id:TEXT:null:pk1", "used_at:TEXT:notnull:pk0"]);
    assert.deepEqual(columns(db, "sessions"), ["id:TEXT:null:pk1", "user_id:TEXT:notnull:pk0", "created_at:TEXT:notnull:pk0", "expires_at:TEXT:notnull:pk0"]);
    assert.deepEqual(columns(db, "assistant_usage"), ["user_id:TEXT:notnull:pk1", "day:TEXT:notnull:pk2", "count:INTEGER:notnull:pk0"]);
    assert.deepEqual(columns(db, "assistant_usage_global"), ["day:TEXT:null:pk1", "count:INTEGER:notnull:pk0"]);

    assert.deepEqual(foreignKeys(db, "sessions"), ["user_id->users.id CASCADE"]);
    assert.deepEqual(foreignKeys(db, "assistant_usage"), ["user_id->users.id CASCADE"]);
    assert.deepEqual(foreignKeys(db, "guest_free_use"), [], "the marker is not linked to any account");

    assert.ok(indexes(db, "guest_free_use").includes("idx_guest_free_use_used_at"));
    assert.ok(indexes(db, "guest_analyses").includes("idx_guest_analyses_created"));
    assert.ok(indexes(db, "sessions").includes("idx_sessions_user"));
    assert.ok(indexes(db, "sessions").includes("idx_sessions_expires"));
    db.close();
  });

  it("upgrades an existing v2 database: markers backfilled first, then claimed guest content deleted", () => {
    const file = tempFile();
    v2Database(file);
    const db = openDb(file);
    assert.equal(version(db), 3);

    const markers = db.prepare("SELECT guest_id, used_at FROM guest_free_use ORDER BY guest_id").all();
    assert.deepEqual(markers.map((m) => ({ ...m })), [
      { guest_id: "guest-a", used_at: "2026-03-01T10:00:00.000Z" }, // marker kept although its only row was claimed
      { guest_id: "guest-b", used_at: "2026-03-02T10:00:00.000Z" },
      { guest_id: "guest-c", used_at: "2026-03-03T10:00:00.000Z" }, // earliest of its rows
    ]);

    const remaining = (db.prepare("SELECT id FROM guest_analyses ORDER BY id").all() as Array<{ id: string }>).map((r) => r.id);
    assert.deepEqual(remaining, ["g-c2", "g-unclaimed"], "claimed rows are gone, unclaimed rows stay");
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE result_json LIKE '%claimed content%' AND id = 'g-claimed'"), 0);

    // Existing data outside guest_analyses is untouched.
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM users"), 2);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM analyses"), 1);
    for (const t of ["sessions", "assistant_usage", "assistant_usage_global"]) assert.equal(count(db, `SELECT COUNT(*) AS n FROM ${t}`), 0, t);
    db.close();
  });

  it("runs exactly once: reopening a v3 database changes nothing", () => {
    const file = tempFile();
    v2Database(file);
    openDb(file).close();

    const db = openDb(file);
    // Rows written after the upgrade (including a claimed guest row) must survive another open.
    db.prepare("INSERT INTO guest_analyses (id, guest_id, result_json, claimed_by, created_at) VALUES ('g-later', 'guest-d', '{}', 'u1', '2026-04-01T00:00:00.000Z')").run();
    db.close();

    const again = openDb(file);
    assert.equal(version(again), 3);
    assert.equal(count(again, "SELECT COUNT(*) AS n FROM guest_analyses WHERE id = 'g-later'"), 1);
    assert.equal(count(again, "SELECT COUNT(*) AS n FROM guest_free_use"), 3, "backfill did not run again");
    again.close();
  });

  it("rolls back and stays at the old version if the migration fails", () => {
    const file = tempFile();
    v2Database(file);
    const raw = new DatabaseSync(file);
    raw.exec("CREATE TABLE sessions (id TEXT PRIMARY KEY)"); // conflicts with migration 3
    raw.close();
    assert.throws(() => openDb(file), /sessions already exists/);
    const check = new DatabaseSync(file);
    assert.equal(version(check), 2);
    assert.ok(!tables(check).includes("guest_free_use"), "nothing from the failed migration was kept");
    assert.equal(count(check, "SELECT COUNT(*) AS n FROM guest_analyses"), 4, "no guest row was deleted");
    check.close();
  });

  it("cascades session and quota rows when an account is deleted, and enforces keys and checks", () => {
    const db = openDb(":memory:");
    insertUser(db, "u1");
    insertUser(db, "u2");
    const session = db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)");
    session.run("jti-1", "u1", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
    session.run("jti-2", "u1", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
    session.run("jti-3", "u2", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z");
    const usage = db.prepare("INSERT INTO assistant_usage (user_id, day, count) VALUES (?, ?, ?)");
    usage.run("u1", "2026-09-14", 3);
    usage.run("u2", "2026-09-14", 1);
    db.prepare("INSERT INTO assistant_usage_global (day, count) VALUES ('2026-09-14', 4)").run();
    db.prepare("INSERT INTO guest_free_use (guest_id, used_at) VALUES ('guest-x', '2026-09-14T00:00:00.000Z')").run();

    db.prepare("DELETE FROM users WHERE id = 'u1'").run();
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = 'u1'"), 0);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM assistant_usage WHERE user_id = 'u1'"), 0);
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM sessions"), 1, "other users' sessions are untouched");
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM assistant_usage_global"), 1, "global counter is not per-user data");
    assert.equal(count(db, "SELECT COUNT(*) AS n FROM guest_free_use"), 1);

    assert.throws(() => session.run("jti-4", "nobody", "2026-09-14T00:00:00.000Z", "2026-09-21T00:00:00.000Z"), /FOREIGN KEY/);
    assert.throws(() => session.run("jti-3", "u2", "x", "y"), /UNIQUE|PRIMARY KEY/);
    assert.throws(() => usage.run("u2", "2026-09-14", 5), /UNIQUE|PRIMARY KEY/);
    assert.throws(() => usage.run("u2", "2026-09-15", -1), /CHECK/);
    assert.throws(() => db.prepare("INSERT INTO guest_free_use (guest_id, used_at) VALUES ('guest-x', 'x')").run(), /UNIQUE|PRIMARY KEY/);
    db.close();
  });
});
