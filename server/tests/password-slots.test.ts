// P1 D-5: at most 2 concurrent scrypt operations; waiters give up after the wait limit with 503 server_busy.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { config } from "../src/config.js";
import { PASSWORD_BUSY_MESSAGE, PasswordHashSlots, passwordHashSlots } from "../src/security/password-slots.js";
import { getDummyHash, hashPassword, verifyPassword } from "../src/security/password.js";
import { CSRF, signedUpUser, testApp } from "./helpers.js";

const deferred = () => {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
};

const originalWait = passwordHashSlots.waitMs;
afterEach(() => {
  passwordHashSlots.waitMs = originalWait;
});

/** Holds both global password slots until the returned function is called. */
function holdGlobalSlots() {
  const gates = [deferred(), deferred()];
  const held = gates.map((g) => passwordHashSlots.run(() => g.promise));
  return async () => {
    gates.forEach((g) => g.resolve());
    await Promise.all(held);
  };
}

describe("D-5 password hash slots", () => {
  it("uses the approved values and keeps the scrypt parameters", async () => {
    assert.equal(config.security.maxConcurrentPasswordHashes, 2);
    assert.equal(config.security.passwordHashWaitMs, 5000);
    assert.equal(passwordHashSlots.capacity, 2);
    assert.equal(passwordHashSlots.waitMs, 5000);
    const hash = await hashPassword("synthetic-password");
    assert.match(hash, /^scrypt\$131072\$8\$1\$/);
    assert.equal(await verifyPassword("synthetic-password", hash), true);
    assert.equal(await verifyPassword("wrong-password", hash), false);
  });

  it("runs at most 2 operations at once and serves waiters in arrival order", async () => {
    const slots = new PasswordHashSlots(2, 1000);
    let running = 0;
    let peak = 0;
    const order: number[] = [];
    const gates = Array.from({ length: 5 }, deferred);
    const jobs = gates.map((g, i) =>
      slots.run(async () => {
        running++;
        peak = Math.max(peak, running);
        order.push(i);
        await g.promise;
        running--;
      })
    );
    await new Promise((r) => setImmediate(r));
    assert.equal(slots.inUse, 2);
    assert.equal(slots.waiting, 3);
    for (const g of gates) {
      g.resolve();
      await new Promise((r) => setImmediate(r));
    }
    await Promise.all(jobs);
    assert.equal(peak, 2);
    assert.deepEqual(order, [0, 1, 2, 3, 4]);
    assert.equal(slots.inUse, 0);
    assert.equal(slots.waiting, 0);
  });

  it("rejects a waiter after the wait limit with 503 server_busy and Retry-After 5", async () => {
    const slots = new PasswordHashSlots(1, 30);
    const gate = deferred();
    const holder = slots.run(() => gate.promise);
    await assert.rejects(slots.run(async () => "never"), (err: { status: number; code: string; message: string; headers: Record<string, string> }) => {
      assert.equal(err.status, 503);
      assert.equal(err.code, "server_busy");
      assert.equal(err.message, PASSWORD_BUSY_MESSAGE);
      assert.equal(err.message, "The server is busy. Please try again in a few seconds.");
      assert.deepEqual(err.headers, { "Retry-After": "5" });
      return true;
    });
    assert.equal(slots.waiting, 0, "timed-out waiter is removed from the queue");
    gate.resolve();
    await holder;
    assert.equal(slots.inUse, 0);
    assert.equal(await slots.run(async () => "works"), "works", "no slot leaked");
  });

  it("releases the slot when the operation throws", async () => {
    const slots = new PasswordHashSlots(1, 1000);
    await assert.rejects(slots.run(async () => { throw new Error("boom"); }), /boom/);
    assert.equal(slots.inUse, 0);
    assert.equal(await slots.run(async () => 42), 42);
  });

  it("routes real hashing, verification and the dummy hash through the global slots", async () => {
    passwordHashSlots.waitMs = 50;
    const release = holdGlobalSlots();
    try {
      await assert.rejects(hashPassword("x-password"), { status: 503, code: "server_busy" });
      await assert.rejects(verifyPassword("x", "scrypt$131072$8$1$AAAA$AAAA"), { status: 503, code: "server_busy" });
      await assert.rejects(getDummyHash(), { status: 503, code: "server_busy" });
    } finally {
      await release();
    }
    assert.match(await getDummyHash(), /^scrypt\$/, "a failed dummy-hash creation is not cached");
  });

  it("signup, login (known and unknown email), password change and deletion return 503 when no slot frees up", async () => {
    const ctx = await testApp();
    const user = await signedUpUser(ctx, "slots@example.com");
    passwordHashSlots.waitMs = 50;
    const release = holdGlobalSlots();
    try {
      const responses = [
        await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "N", email: "new-slots@example.com", password: "password-123" }),
        await request(ctx.app).post("/api/auth/login").set(CSRF).send({ email: "slots@example.com", password: "correct-horse-1" }),
        await request(ctx.app).post("/api/auth/login").set(CSRF).send({ email: "ghost@example.com", password: "whatever-123" }),
        await user.put("/api/account/password").set(CSRF).send({ currentPassword: "correct-horse-1", newPassword: "another-pass-1" }),
        await user.delete("/api/account").set(CSRF).send({ currentPassword: "correct-horse-1" }),
      ];
      for (const res of responses) {
        assert.equal(res.status, 503, JSON.stringify(res.body));
        assert.equal(res.headers["retry-after"], "5");
        assert.deepEqual(res.body, { error: { code: "server_busy", message: "The server is busy. Please try again in a few seconds." } });
      }
    } finally {
      await release();
    }
    passwordHashSlots.waitMs = originalWait;
    const ok = await request(ctx.app).post("/api/auth/login").set(CSRF).send({ email: "slots@example.com", password: "correct-horse-1" });
    assert.equal(ok.status, 200, "normal requests work again once slots are free");
    assert.equal((await user.get("/api/auth/me")).status, 200, "the busy password change/deletion changed nothing");
  });

  it("never runs more than 2 scrypt operations during a burst of logins", async () => {
    const ctx = await testApp();
    await signedUpUser(ctx, "burst@example.com");
    let peak = 0;
    const sampler = setInterval(() => (peak = Math.max(peak, passwordHashSlots.inUse)), 1);
    const logins = await Promise.all(
      Array.from({ length: 5 }, () => request(ctx.app).post("/api/auth/login").set(CSRF).send({ email: "burst@example.com", password: "correct-horse-1" }))
    );
    clearInterval(sampler);
    assert.ok(logins.every((r) => r.status === 200));
    assert.ok(peak <= 2 && peak >= 1, `peak ${peak}`);
    assert.equal(passwordHashSlots.inUse, 0);
  });
});
