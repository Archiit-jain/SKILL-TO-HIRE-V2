// P1 D-6: guest free-use marker (365 days), unclaimed guest results (30 days), claim deletes guest content, account
// deletion leaves nothing behind. Synthetic data; old timestamps are written straight into the test database.
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { describe, it } from "node:test";
import request from "supertest";
import { config } from "../src/config.js";
import { recordGuestAnalysis } from "../src/security/guest.js";
import { analyseAs, count, CSRF, testApp, type TestApp } from "./helpers.js";

const DAY = 24 * 3600 * 1000;
const daysAgo = (d: number) => new Date(Date.now() - d * DAY).toISOString();
const guestCookie = () => `s2h_guest=${randomBytes(24).toString("hex")}`;
const guestIdOf = (cookie: string) => cookie.slice("s2h_guest=".length);

async function guestAnalysis(ctx: TestApp, cookie: string) {
  const res = await analyseAs(request(ctx.app) as never).set("Cookie", cookie);
  return res;
}

async function signUpInBrowser(ctx: TestApp, cookie: string, email: string) {
  const agent = request.agent(ctx.app);
  const s = await agent.post("/api/auth/signup").set(CSRF).set("Cookie", cookie).send({ name: "Guest Convert", email, password: "password-123" });
  assert.equal(s.status, 201);
  const v = await agent.post("/api/auth/verify-email").set(CSRF).set("Cookie", cookie).send({ token: ctx.tokenFor(email) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return agent;
}

describe("D-6 guest lifecycle", () => {
  it("uses the approved retention periods", () => {
    assert.equal(config.security.guestAnalysisRetentionDays, 30);
    assert.equal(config.security.guestFreeUseRetentionDays, 365);
  });

  it("records a free-use marker with the first guest analysis and rejects the second", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    const first = await guestAnalysis(ctx, cookie);
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_free_use WHERE guest_id = ?", guestIdOf(cookie)), 1);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE guest_id = ?", guestIdOf(cookie)), 1);
    const second = await guestAnalysis(ctx, cookie);
    assert.equal(second.status, 401);
    assert.equal(second.body.error.code, "login_required");
  });

  it("counts free use from the marker, not from guest_analyses", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    assert.equal((await guestAnalysis(ctx, cookie)).status, 201);
    (await ctx.db.run("DELETE FROM guest_analyses WHERE guest_id = ?", guestIdOf(cookie)));
    assert.equal((await guestAnalysis(ctx, cookie)).status, 401, "marker still blocks after the result is gone");

    const other = guestCookie();
    (await ctx.db.run("INSERT INTO guest_analyses (id, guest_id, result_json, created_at) VALUES ('legacy-row', ?, '{}', ?)", guestIdOf(other), daysAgo(1)));
    assert.equal((await guestAnalysis(ctx, other)).status, 201, "a result row without a marker doesn't block");
  });

  it("lets only one of two parallel requests from the same browser use the free analysis", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    const results = await Promise.all([guestAnalysis(ctx, cookie), guestAnalysis(ctx, cookie)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 401]);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE guest_id = ?", guestIdOf(cookie)), 1);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_free_use WHERE guest_id = ?", guestIdOf(cookie)), 1);
  });

  it("moves the guest result into the account on sign-in, deletes the guest row and keeps the marker", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    const first = await guestAnalysis(ctx, cookie);
    assert.equal(first.status, 201);
    const agent = await signUpInBrowser(ctx, cookie, "claim@example.com");

    const history = await agent.get("/api/analyses");
    assert.deepEqual(history.body.analyses.map((a: { id: string }) => a.id), [first.body.result.id]);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE guest_id = ?", guestIdOf(cookie)), 0, "claimed content is deleted");
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_free_use WHERE guest_id = ?", guestIdOf(cookie)), 1, "marker stays");

    await agent.post("/api/auth/logout").set(CSRF);
    assert.equal((await guestAnalysis(ctx, cookie)).status, 401, "logging out doesn't grant another free analysis");
    assert.equal((await request(ctx.app).get("/api/analyses/latest").set("Cookie", cookie)).body.result, null);
  });

  it("returns unclaimed guest results only up to 30 days and purges older ones", async () => {
    const ctx = await testApp();
    const recent = guestCookie();
    const old = guestCookie();
    assert.equal((await guestAnalysis(ctx, recent)).status, 201);
    assert.equal((await guestAnalysis(ctx, old)).status, 201);
    (await ctx.db.run("UPDATE guest_analyses SET created_at = ? WHERE guest_id = ?", daysAgo(29), guestIdOf(recent)));
    (await ctx.db.run("UPDATE guest_analyses SET created_at = ? WHERE guest_id = ?", daysAgo(31), guestIdOf(old)));

    assert.notEqual((await request(ctx.app).get("/api/analyses/latest").set("Cookie", recent)).body.result, null);
    assert.equal((await request(ctx.app).get("/api/analyses/latest").set("Cookie", old)).body.result, null);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE guest_id = ?", guestIdOf(old)), 0, "expired result purged");
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE guest_id = ?", guestIdOf(recent)), 1, "recent result kept");
    assert.equal((await guestAnalysis(ctx, old)).status, 401, "the marker (under 365 days) still counts after the result expired");
  });

  it("doesn't claim a guest result older than 30 days", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    assert.equal((await guestAnalysis(ctx, cookie)).status, 201);
    (await ctx.db.run("UPDATE guest_analyses SET created_at = ? WHERE guest_id = ?", daysAgo(31), guestIdOf(cookie)));
    const agent = await signUpInBrowser(ctx, cookie, "late@example.com");
    assert.equal((await agent.get("/api/analyses")).body.analyses.length, 0);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses"), 0);
  });

  it("lets a browser analyse again once its marker is older than 365 days", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    assert.equal((await guestAnalysis(ctx, cookie)).status, 201);
    (await ctx.db.run("UPDATE guest_free_use SET used_at = ? WHERE guest_id = ?", daysAgo(366), guestIdOf(cookie)));
    (await ctx.db.run("UPDATE guest_analyses SET created_at = ? WHERE guest_id = ?", daysAgo(366), guestIdOf(cookie)));
    const again = await guestAnalysis(ctx, cookie);
    assert.equal(again.status, 201, JSON.stringify(again.body));
    const marker = (await ctx.db.get("SELECT used_at FROM guest_free_use WHERE guest_id = ?", guestIdOf(cookie))) as { used_at: string };
    assert.ok(Date.now() - Date.parse(marker.used_at) < DAY, "marker renewed");
    assert.equal((await guestAnalysis(ctx, cookie)).status, 401);
  });

  it("the marker insert is the atomic gate: a second record for the same browser stores nothing", async () => {
    const ctx = await testApp();
    const id = guestIdOf(guestCookie());
    const now = new Date().toISOString();
    assert.equal(await recordGuestAnalysis(ctx.db, id, "r1", "{}", now), true);
    assert.equal(await recordGuestAnalysis(ctx.db, id, "r2", "{}", now), false);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE guest_id = ?", id), 1);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE id = 'r2'"), 0, "rolled back");
  });

  it("an expired marker is replaced atomically even when requests race", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    (await ctx.db.run("INSERT INTO guest_free_use (guest_id, used_at) VALUES (?, ?)", guestIdOf(cookie), daysAgo(400)));
    const results = await Promise.all([guestAnalysis(ctx, cookie), guestAnalysis(ctx, cookie)]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 401]);
  });

  it("account deletion leaves no analysis content behind, including claimed guest content", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    assert.equal((await guestAnalysis(ctx, cookie)).status, 201);
    const agent = await signUpInBrowser(ctx, cookie, "delete-me@example.com");
    assert.equal((await analyseAs(agent)).status, 201);
    const id = ((await ctx.db.get("SELECT id FROM users WHERE email = 'delete-me@example.com'")) as { id: string }).id;
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM analyses WHERE user_id = ?", id), 2);

    assert.equal((await agent.delete("/api/account").set(CSRF).send({ currentPassword: "password-123" })).status, 204);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM analyses WHERE user_id = ?", id), 0);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses"), 0);
    assert.equal((await request(ctx.app).get("/api/analyses/latest").set("Cookie", cookie)).body.result, null, "H-2 is fixed");
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_free_use WHERE guest_id = ?", guestIdOf(cookie)), 1);
  });

  it("a pre-P1 leftover (looks unclaimed after its account was deleted) disappears after 30 days", async () => {
    const ctx = await testApp();
    const cookie = guestCookie();
    (await ctx.db.run("INSERT INTO guest_free_use (guest_id, used_at) VALUES (?, ?)", guestIdOf(cookie), daysAgo(40)));
    (await ctx.db.run("INSERT INTO guest_analyses (id, guest_id, result_json, claimed_by, created_at) VALUES ('leftover', ?, '{\"id\":\"leftover\"}', NULL, ?)", guestIdOf(cookie), daysAgo(40)));
    assert.equal((await request(ctx.app).get("/api/analyses/latest").set("Cookie", cookie)).body.result, null);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses WHERE id = 'leftover'"), 0);
  });
});
