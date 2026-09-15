// P1 D-7: database-backed sessions. A token works only while its jti row exists, belongs to the same user and hasn't
// expired, on top of the signature and token-version checks.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { describe, it } from "node:test";
import jwt from "jsonwebtoken";
import request from "supertest";
import { config } from "../src/config.js";
import type { GoogleIdentity } from "../src/security/google.js";
import { createSession, signSession } from "../src/security/session.js";
import { count, CSRF, loginDevice, sessionCookie, signedUpUser, testApp, type TestApp } from "./helpers.js";

const me = (app: TestApp["app"], cookie: string) => request(app).get("/api/auth/me").set("Cookie", cookie);
const userId = async (ctx: TestApp, email: string) => ((await ctx.db.get("SELECT id FROM users WHERE email = ?", email)) as { id: string }).id;

async function loginCookie(ctx: TestApp, email: string, password = "correct-horse-1") {
  const res = await request(ctx.app).post("/api/auth/login").set(CSRF).send({ email, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return sessionCookie(res);
}

describe("D-7 sessions", () => {
  it("creates a session row whose id is the JWT jti, keeping sub/tv/iss/aud and the 168 h lifetime", async () => {
    const ctx = await testApp();
    await signedUpUser(ctx, "one@example.com");
    const cookie = await loginCookie(ctx, "one@example.com");
    const token = cookie.slice("s2h_session=".length);
    const claims = jwt.verify(token, config.jwtSecret, { algorithms: ["HS256"], issuer: "skill2hire", audience: "skill2hire-web" }) as jwt.JwtPayload;
    const id = await userId(ctx, "one@example.com");
    assert.equal(claims.sub, id);
    assert.equal(claims.tv, 0);
    assert.equal(typeof claims.jti, "string");
    assert.equal(claims.exp! - claims.iat!, 168 * 3600);
    const row = (await ctx.db.get("SELECT user_id, created_at, expires_at FROM sessions WHERE id = ?", claims.jti!)) as {
      user_id: string; created_at: string; expires_at: string;
    };
    assert.equal(row.user_id, id);
    assert.equal(Date.parse(row.expires_at) - Date.parse(row.created_at), 168 * 3600 * 1000);
    assert.equal((await me(ctx.app, cookie)).status, 200);
  });

  it("logout revokes only the current session, immediately, and is idempotent", async () => {
    const ctx = await testApp();
    await signedUpUser(ctx, "two@example.com");
    const deviceA = await loginCookie(ctx, "two@example.com");
    const deviceB = await loginCookie(ctx, "two@example.com");

    const logout = await request(ctx.app).post("/api/auth/logout").set(CSRF).set("Cookie", deviceA);
    assert.equal(logout.status, 204);
    assert.match(String(logout.headers["set-cookie"]), /s2h_session=;/, "cookie cleared");
    assert.equal((await me(ctx.app, deviceA)).status, 401, "a copied token stops working right after logout");
    assert.equal((await me(ctx.app, deviceB)).status, 200, "the other device stays signed in");

    assert.equal((await request(ctx.app).post("/api/auth/logout").set(CSRF).set("Cookie", deviceA)).status, 204);
    assert.equal((await request(ctx.app).post("/api/auth/logout").set(CSRF)).status, 204);
    assert.equal((await request(ctx.app).post("/api/auth/logout").set(CSRF).set("Cookie", "s2h_session=garbage")).status, 204);
  });

  it("logout-all revokes every device and bumps the token version", async () => {
    const ctx = await testApp();
    await signedUpUser(ctx, "three@example.com");
    const a = await loginCookie(ctx, "three@example.com");
    const b = await loginCookie(ctx, "three@example.com");
    const id = await userId(ctx, "three@example.com");
    assert.equal((await request(ctx.app).post("/api/auth/logout-all").set(CSRF).set("Cookie", a)).status, 204);
    assert.equal((await me(ctx.app, a)).status, 401);
    assert.equal((await me(ctx.app, b)).status, 401);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", id), 0);
    assert.equal(((await ctx.db.get("SELECT token_version AS v FROM users WHERE id = ?", id)) as { v: number }).v, 1);
  });

  it("password change revokes all sessions and issues a new working session for this device", async () => {
    const ctx = await testApp();
    const current = await signedUpUser(ctx, "four@example.com");
    const other = await loginCookie(ctx, "four@example.com");
    const before = await loginCookie(ctx, "four@example.com");
    const res = await current.put("/api/account/password").set(CSRF).send({ currentPassword: "correct-horse-1", newPassword: "brand-new-pass" });
    assert.equal(res.status, 204);
    const fresh = sessionCookie(res);
    assert.equal((await me(ctx.app, other)).status, 401);
    assert.equal((await me(ctx.app, before)).status, 401);
    assert.equal((await me(ctx.app, fresh)).status, 200);
    assert.equal((await current.get("/api/auth/me")).status, 200);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", await userId(ctx, "four@example.com")), 1);
  });

  it("email change signs out other devices and reissues the current session", async () => {
    const ctx = await testApp();
    const current = await signedUpUser(ctx, "five@example.com");
    const otherDevice = await loginDevice(ctx, "five@example.com");
    const oldCurrent = await loginCookie(ctx, "five@example.com");
    const res = await current.patch("/api/account").set(CSRF).send({ name: "Five", email: "five-new@example.com", currentPassword: "correct-horse-1" });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const fresh = sessionCookie(res);
    assert.equal((await otherDevice.get("/api/auth/me")).status, 401, "other devices are signed out");
    assert.equal((await me(ctx.app, oldCurrent)).status, 401);
    assert.equal((await me(ctx.app, fresh)).status, 200, "the current device keeps working with the new session");
    assert.equal((await current.get("/api/auth/me")).status, 200);
  });

  it("a name-only profile update does not revoke sessions", async () => {
    const ctx = await testApp();
    const current = await signedUpUser(ctx, "rename@example.com");
    const other = await loginCookie(ctx, "rename@example.com");
    assert.equal((await current.patch("/api/account").set(CSRF).send({ name: "Renamed", email: "rename@example.com" })).status, 200);
    assert.equal((await me(ctx.app, other)).status, 200);
  });

  it("Google takeover of an unverified registration deletes that account's existing sessions", async () => {
    const verifyGoogle = async (credential: string): Promise<GoogleIdentity | null> =>
      credential === "google-credential-for-owner-padding" ? { sub: "google-sub-1", email: "owner@example.com", emailVerified: true, name: "Owner" } : null;
    const ctx = await testApp({ verifyGoogle, googleClientId: "test-client-id.apps.googleusercontent.com" });
    const signup = await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "Squatter", email: "owner@example.com", password: "squatter-pass-1" });
    assert.equal(signup.status, 201);
    const id = await userId(ctx, "owner@example.com");
    const squatterToken = `s2h_session=${await createSession(ctx.db, id, 0)}`;
    assert.equal((await me(ctx.app, squatterToken)).status, 200);

    const google = await request(ctx.app).post("/api/auth/google").set(CSRF).send({ credential: "google-credential-for-owner-padding" });
    assert.equal(google.status, 200, JSON.stringify(google.body));
    assert.equal((await me(ctx.app, squatterToken)).status, 401);
    assert.equal((await me(ctx.app, sessionCookie(google))).status, 200);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", id), 1);
  });

  it("rejects unknown jti, another user's jti, expired sessions, tokens without jti and stale token versions", async () => {
    const ctx = await testApp();
    await signedUpUser(ctx, "alice@example.com");
    await signedUpUser(ctx, "bob@example.com");
    const alice = await userId(ctx, "alice@example.com");
    const bob = await userId(ctx, "bob@example.com");

    assert.equal((await me(ctx.app, `s2h_session=${signSession(alice, 0, randomUUID())}`)).status, 401, "unknown jti");

    const bobCookie = await loginCookie(ctx, "bob@example.com", "correct-horse-1");
    const bobJti = (jwt.decode(bobCookie.slice(12)) as jwt.JwtPayload).jti!;
    assert.equal((await me(ctx.app, `s2h_session=${signSession(alice, 0, bobJti)}`)).status, 401, "jti of another user's session");

    const aliceCookie = await loginCookie(ctx, "alice@example.com");
    const aliceJti = (jwt.decode(aliceCookie.slice(12)) as jwt.JwtPayload).jti!;
    (await ctx.db.run("UPDATE sessions SET expires_at = ? WHERE id = ?", new Date(Date.now() - 1000).toISOString(), aliceJti));
    assert.equal((await me(ctx.app, aliceCookie)).status, 401, "expired session row");

    const noJti = jwt.sign({ tv: 0 }, config.jwtSecret, { algorithm: "HS256", subject: alice, expiresIn: 3600, issuer: "skill2hire", audience: "skill2hire-web" });
    assert.equal((await me(ctx.app, `s2h_session=${noJti}`)).status, 401, "pre-D-7 token without jti");

    const fresh = await loginCookie(ctx, "bob@example.com");
    (await ctx.db.run("UPDATE users SET token_version = token_version + 1 WHERE id = ?", bob));
    assert.equal((await me(ctx.app, fresh)).status, 401, "token-version revocation still applies with a live session row");
  });

  it("deleting the account removes its sessions, and expired rows are cleaned when a session is created", async () => {
    const ctx = await testApp();
    const agent = await signedUpUser(ctx, "gone@example.com");
    const id = await userId(ctx, "gone@example.com");
    await loginCookie(ctx, "gone@example.com");
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", id), 2);
    assert.equal((await agent.delete("/api/account").set(CSRF).send({ currentPassword: "correct-horse-1" })).status, 204);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM sessions WHERE user_id = ?", id), 0);

    await signedUpUser(ctx, "stale@example.com");
    const staleId = await userId(ctx, "stale@example.com");
    (await ctx.db.run("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES ('old-session', ?, '2020-01-01T00:00:00.000Z', '2020-01-08T00:00:00.000Z')", staleId));
    await loginCookie(ctx, "stale@example.com");
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM sessions WHERE id = 'old-session'"), 0);
  });
});
