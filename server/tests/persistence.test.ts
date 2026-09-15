// Persistent storage (hackathon release): database selection, data surviving a restart, the storage flag the banner
// relies on, and account deletion that doesn't depend on foreign-key enforcement. Synthetic data, temporary files.
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { after, describe, it } from "node:test";
import request from "supertest";
import { resolveDatabaseConfig } from "../src/config.js";
import { openDb } from "../src/db.js";
import { analyseAs, count, CSRF, loginDevice, signedUpUser, testApp } from "./helpers.js";

const dir = mkdtempSync(path.join(tmpdir(), "s2h-persistence-"));
after(() => {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch (err) {
    // libSQL releases file handles asynchronously; a still-locked temp file on Windows is not a test failure.
    if (!["EPERM", "EBUSY"].includes((err as NodeJS.ErrnoException).code ?? "")) throw err;
  }
});

describe("database selection", () => {
  const base = { databasePath: "/tmp/skill2hire.db" };

  it("uses the hosted database when TURSO_DATABASE_URL is set, on Vercel and elsewhere", () => {
    for (const onVercel of [true, false]) {
      assert.deepEqual(
        resolveDatabaseConfig({ ...base, nodeEnv: "production", onVercel, tursoUrl: "libsql://synthetic-db.example.turso.io", tursoAuthToken: "synthetic-token" }),
        { url: "libsql://synthetic-db.example.turso.io", authToken: "synthetic-token", ephemeral: false }
      );
    }
  });

  it("marks the Vercel /tmp fallback as ephemeral, and a local file elsewhere as persistent", () => {
    assert.equal(resolveDatabaseConfig({ ...base, nodeEnv: "production", onVercel: true }).ephemeral, true);
    assert.deepEqual(resolveDatabaseConfig({ nodeEnv: "development", onVercel: false, databasePath: "server/data/skill2hire.db" }), {
      url: "server/data/skill2hire.db",
      ephemeral: false,
    });
  });

  it("always uses a private in-memory database in tests, even if a hosted database is configured", () => {
    assert.equal(resolveDatabaseConfig({ ...base, nodeEnv: "test", onVercel: false, tursoUrl: "libsql://synthetic-db.example.turso.io" }).url, ":memory:");
  });

  it("rejects a malformed TURSO_DATABASE_URL instead of silently falling back to temporary storage", () => {
    assert.throws(() => resolveDatabaseConfig({ ...base, nodeEnv: "production", onVercel: true, tursoUrl: "synthetic-db.turso.io" }), /libsql:\/\//);
    assert.throws(() => resolveDatabaseConfig({ ...base, nodeEnv: "production", onVercel: true, tursoUrl: "http://insecure.example" }), /libsql:\/\//);
  });
});

describe("persistence", () => {
  it("keeps accounts and analyses across a server restart", async () => {
    const file = path.join(dir, "restart.db");
    const first = await testApp({}, await openDb({ url: file }));
    const agent = await signedUpUser(first, "persist@example.com");
    const created = await analyseAs(agent);
    assert.equal(created.status, 201, JSON.stringify(created.body));
    first.db.close();

    // A new process: fresh app, same database file.
    const second = await testApp({}, await openDb({ url: file }));
    const device = await loginDevice(second, "persist@example.com");
    const list = await device.get("/api/analyses");
    assert.equal(list.status, 200);
    assert.deepEqual(list.body.analyses.map((a: { id: string }) => a.id), [created.body.result.id]);
    const one = await device.get(`/api/analyses/${created.body.result.id}`);
    assert.equal(one.body.result.overallScore, created.body.result.overallScore);
    second.db.close();
  });

  it("reports whether stored data persists, for the frontend banner", async () => {
    const memory = await testApp();
    assert.equal((await request(memory.app).get("/api/auth/providers")).body.persistentStorage, false);

    const fileDb = await openDb({ url: path.join(dir, "flag.db") });
    assert.equal((await request((await testApp({}, fileDb)).app).get("/api/auth/providers")).body.persistentStorage, true);
    fileDb.close();

    const tmpFallback = await openDb({ url: path.join(dir, "vercel-tmp.db"), ephemeral: true });
    assert.equal((await request((await testApp({}, tmpFallback)).app).get("/api/auth/providers")).body.persistentStorage, false);
    tmpFallback.close();
  });

  it("account deletion removes every row of the account even without foreign-key enforcement", async () => {
    const ctx = await testApp();
    // A hosted database connection may not enforce ON DELETE CASCADE; deletion must not rely on it.
    await ctx.db.exec("PRAGMA foreign_keys = OFF");
    const agent = await signedUpUser(ctx, "leave@example.com", "password-123");
    assert.equal((await analyseAs(agent)).status, 201);
    await loginDevice(ctx, "leave@example.com", "password-123"); // a second session
    const { id } = (await ctx.db.get<{ id: string }>("SELECT id FROM users WHERE email = 'leave@example.com'"))!;
    await ctx.db.run("INSERT INTO email_verifications (token_hash, user_id, expires_at, created_at) VALUES ('synthetic-hash', ?, 0, 0)", id);
    await ctx.db.run("INSERT INTO assistant_usage (user_id, day, count) VALUES (?, '2026-09-15', 2)", id);
    const owned = ["analyses", "sessions", "email_verifications", "assistant_usage"];
    for (const t of owned) assert.ok((await count(ctx.db, `SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, id)) > 0, t);

    assert.equal((await agent.delete("/api/account").set(CSRF).send({ currentPassword: "password-123" })).status, 204);
    for (const t of owned) assert.equal(await count(ctx.db, `SELECT COUNT(*) AS n FROM ${t} WHERE user_id = ?`, id), 0, t);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM users WHERE id = ?", id), 0);
  });
});
