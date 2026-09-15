// P1 D-8: 5 failed logins per account per 15 minutes, 60 assistant requests per user per hour. Clocks are injected.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { config } from "../src/config.js";
import { FixedWindowCounter } from "../src/security/fixed-window.js";
import { CSRF, signedUpUser, testApp, type TestApp } from "./helpers.js";

const RATE_LIMITED = { error: { code: "rate_limited", message: "Too many requests, please try again later" } };

function clock(start = Date.parse("2026-09-14T10:00:00Z")) {
  let t = start;
  return { now: () => t, advance: (ms: number) => (t += ms) };
}

const login = (app: TestApp["app"], email: string, password: string) =>
  request(app).post("/api/auth/login").set(CSRF).send({ email, password });

describe("D-8 failed-login limit per account", () => {
  it("uses the approved values", () => {
    assert.equal(config.security.failedLoginsPerAccount, 5);
    assert.equal(config.security.failedLoginWindowMs, 15 * 60_000);
  });

  it("blocks the 6th attempt within 15 minutes, even with the right password, and unblocks after the window", async () => {
    const c = clock();
    const ctx = await testApp({ failedLogins: new FixedWindowCounter(5, 15 * 60_000, c.now) });
    await signedUpUser(ctx, "victim@example.com");
    for (let i = 0; i < 5; i++) assert.equal((await login(ctx.app, "victim@example.com", "wrong-password")).status, 401);
    const blocked = await login(ctx.app, "victim@example.com", "correct-horse-1");
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, RATE_LIMITED);
    assert.equal(blocked.headers["retry-after"], String(15 * 60));
    assert.equal((await login(ctx.app, "VICTIM@example.com ", "correct-horse-1")).status, 429, "email is normalised");

    c.advance(15 * 60_000);
    assert.equal((await login(ctx.app, "victim@example.com", "correct-horse-1")).status, 200);
  });

  it("gives unknown and known emails the identical response, so the limit reveals nothing", async () => {
    // Fixed clock: Retry-After depends only on when each email's window started, not on whether the account exists.
    const c = clock();
    const ctx = await testApp({ failedLogins: new FixedWindowCounter(5, 15 * 60_000, c.now) });
    await signedUpUser(ctx, "known@example.com");
    for (let i = 0; i < 5; i++) {
      await login(ctx.app, "known@example.com", "wrong-password");
      await login(ctx.app, "unknown@example.com", "wrong-password");
    }
    const known = await login(ctx.app, "known@example.com", "wrong-password");
    const unknown = await login(ctx.app, "unknown@example.com", "wrong-password");
    assert.equal(known.status, 429);
    assert.equal(unknown.status, 429);
    assert.deepEqual(known.body, unknown.body);
    assert.equal(known.headers["retry-after"], unknown.headers["retry-after"]);
  });

  it("a successful login resets the count; other accounts are unaffected", async () => {
    const ctx = await testApp();
    await signedUpUser(ctx, "resets@example.com");
    await signedUpUser(ctx, "bystander@example.com");
    for (let i = 0; i < 4; i++) await login(ctx.app, "resets@example.com", "wrong-password");
    assert.equal((await login(ctx.app, "resets@example.com", "correct-horse-1")).status, 200);
    for (let i = 0; i < 5; i++) assert.equal((await login(ctx.app, "resets@example.com", "wrong-password")).status, 401);
    assert.equal((await login(ctx.app, "resets@example.com", "wrong-password")).status, 429);
    assert.equal((await login(ctx.app, "bystander@example.com", "correct-horse-1")).status, 200);
  });

  it("parallel guesses can't get past the limit", async () => {
    const ctx = await testApp();
    await signedUpUser(ctx, "parallel@example.com");
    const results = await Promise.all(Array.from({ length: 10 }, () => login(ctx.app, "parallel@example.com", "wrong-password")));
    const statuses = results.map((r) => r.status);
    assert.equal(statuses.filter((s) => s === 401).length, 5);
    assert.equal(statuses.filter((s) => s === 429).length, 5);
  });

  it("the counter keeps no plaintext email and forgets expired windows", () => {
    const c = clock();
    const counter = new FixedWindowCounter(5, 1000, c.now);
    counter.record("a");
    counter.record("b");
    c.advance(1000);
    counter.record("c");
    assert.equal(counter.size, 1, "expired windows are swept");
    assert.equal(counter.blockedFor("c"), null);
  });
});

describe("D-8 assistant requests per user", () => {
  it("uses the approved values", () => {
    assert.equal(config.security.assistantRequestsPerUser, 60);
    assert.equal(config.security.assistantWindowMs, 60 * 60_000);
  });

  it("allows 60 requests per user per hour, then 429 until the window ends; other users are unaffected", async () => {
    const c = clock();
    const ctx = await testApp({ assistantRequests: new FixedWindowCounter(60, 60 * 60_000, c.now) });
    const alice = await signedUpUser(ctx, "alice-rate@example.com");
    const bob = await signedUpUser(ctx, "bob-rate@example.com");
    for (let i = 0; i < 60; i++) {
      const res = await alice.post("/api/assistant/chat").set(CSRF).send({ question: "What should I improve first?" });
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const blocked = await alice.post("/api/assistant/chat").set(CSRF).send({ question: "One more?" });
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, RATE_LIMITED);
    assert.equal(blocked.headers["retry-after"], "3600");
    assert.equal((await bob.post("/api/assistant/chat").set(CSRF).send({ question: "Hi" })).status, 200);

    c.advance(60 * 60_000);
    assert.equal((await alice.post("/api/assistant/chat").set(CSRF).send({ question: "Back again" })).status, 200);
  });
});
