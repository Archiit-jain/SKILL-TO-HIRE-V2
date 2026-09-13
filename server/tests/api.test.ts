import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDb } from "../src/db.js";
import { makePdf, SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";

const CSRF = { "X-Requested-With": "skill2hire" };

function newApp() {
  return createApp(openDb(":memory:"));
}

async function signup(app: ReturnType<typeof newApp>, email = "student@example.com", password = "correct-horse-1") {
  const agent = request.agent(app);
  const res = await agent.post("/api/auth/signup").set(CSRF).send({ name: "Test Student", email, password });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return agent;
}

describe("auth", () => {
  const app = newApp();

  it("signs up, sets a hardened cookie and restores the session", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/signup").set(CSRF).send({ name: "A", email: "A@Example.com", password: "password-123" });
    assert.equal(res.status, 201);
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.ok(!JSON.stringify(res.body).includes("password"));
    const me = await agent.get("/api/auth/me");
    assert.equal(me.status, 200);
    assert.equal(me.body.user.email, "a@example.com");
  });

  it("rejects duplicate email, weak password and bad email", async () => {
    const dup = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "B", email: "a@example.com", password: "password-123" });
    assert.equal(dup.status, 409);
    const weak = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "B", email: "b@example.com", password: "short" });
    assert.equal(weak.status, 400);
    const bad = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "B", email: "not-an-email", password: "password-123" });
    assert.equal(bad.status, 400);
  });

  it("uses a generic login error and never accepts a wrong password", async () => {
    const wrong = await request(app).post("/api/auth/login").set(CSRF).send({ email: "a@example.com", password: "nope-nope-nope" });
    const unknown = await request(app).post("/api/auth/login").set(CSRF).send({ email: "ghost@example.com", password: "nope-nope-nope" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
    const ok = await request(app).post("/api/auth/login").set(CSRF).send({ email: "a@example.com", password: "password-123" });
    assert.equal(ok.status, 200);
  });

  it("blocks requests without the CSRF header or from a foreign origin", async () => {
    const noHeader = await request(app).post("/api/auth/login").send({ email: "a@example.com", password: "password-123" });
    assert.equal(noHeader.status, 403);
    const foreign = await request(app)
      .post("/api/auth/login")
      .set(CSRF)
      .set("Origin", "https://evil.example")
      .send({ email: "a@example.com", password: "password-123" });
    assert.equal(foreign.status, 403);
  });

  it("rejects forged and missing tokens", async () => {
    assert.equal((await request(app).get("/api/auth/me")).status, 401);
    const forged = await request(app).get("/api/auth/me").set("Cookie", "s2h_session=eyJhbGciOiJub25lIn0.eyJzdWIiOiJ4IiwidHYiOjB9.");
    assert.equal(forged.status, 401);
  });

  it("sets security headers", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.ok(res.headers["content-security-policy"]);
    assert.equal(res.headers["x-powered-by"], undefined);
  });
});

describe("account", () => {
  const app = newApp();

  it("changes password, revoking the old session", async () => {
    const agent = await signup(app);
    const other = request.agent(app);
    await other.post("/api/auth/login").set(CSRF).send({ email: "student@example.com", password: "correct-horse-1" });
    assert.equal((await other.get("/api/auth/me")).status, 200);

    const bad = await agent.put("/api/account/password").set(CSRF).send({ currentPassword: "wrong-password", newPassword: "brand-new-pass" });
    assert.equal(bad.status, 403);
    const ok = await agent.put("/api/account/password").set(CSRF).send({ currentPassword: "correct-horse-1", newPassword: "brand-new-pass" });
    assert.equal(ok.status, 204);

    assert.equal((await agent.get("/api/auth/me")).status, 200, "current device stays signed in");
    assert.equal((await other.get("/api/auth/me")).status, 401, "other sessions are revoked");
  });

  it("requires the password to change email and to delete the account", async () => {
    const agent = await signup(app, "second@example.com");
    const noPw = await agent.patch("/api/account").set(CSRF).send({ name: "X", email: "new@example.com" });
    assert.equal(noPw.status, 403);
    const rename = await agent.patch("/api/account").set(CSRF).send({ name: "Renamed", email: "second@example.com" });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.user.name, "Renamed");

    const settings = await agent.put("/api/account/settings").set(CSRF).send({ privacyMode: false, notifications: false });
    assert.equal(settings.status, 200);
    assert.deepEqual((await agent.get("/api/account/settings")).body, { privacyMode: false, notifications: false });

    assert.equal((await agent.delete("/api/account").set(CSRF).send({ currentPassword: "wrong" })).status, 403);
    assert.equal((await agent.delete("/api/account").set(CSRF).send({ currentPassword: "correct-horse-1" })).status, 204);
    assert.equal((await agent.get("/api/auth/me")).status, 401);
  });
});

describe("analyses", () => {
  const app = newApp();
  let alice: Awaited<ReturnType<typeof signup>>;
  let bob: Awaited<ReturnType<typeof signup>>;
  let analysisId = "";

  before(async () => {
    alice = await signup(app, "alice@example.com");
    bob = await signup(app, "bob@example.com");
  });

  it("requires authentication", async () => {
    const res = await request(app).post("/api/analyses").set(CSRF).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(res.status, 401);
  });

  it("analyses an uploaded PDF against pasted JD text", async () => {
    const res = await alice
      .post("/api/analyses")
      .set(CSRF)
      .field("jdText", SAMPLE_JD)
      .attach("resume", makePdf(SAMPLE_RESUME), "Priya_Sharma.pdf");
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const r = res.body.result;
    analysisId = r.id;
    assert.equal(r.jdTitle, "Data Engineer");
    assert.equal(r.resumeName, "resume.pdf", "privacy mode is on by default");
    assert.ok(r.missingSkills.some((s: { skill: string }) => s.skill === "Kubernetes"));
  });

  it("accepts a JD as a .txt upload", async () => {
    const res = await alice
      .post("/api/analyses")
      .set(CSRF)
      .attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf")
      .attach("jdFile", Buffer.from(SAMPLE_JD), "jd.txt");
    assert.equal(res.status, 201, JSON.stringify(res.body));
  });

  it("rejects spoofed files, oversize files and missing JD", async () => {
    const spoofed = await alice.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", Buffer.from("MZ\x90\x00 not a pdf"), "cv.pdf");
    assert.equal(spoofed.status, 415);
    const big = await alice.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", Buffer.alloc(5 * 1024 * 1024 + 1, 0x25), "cv.pdf");
    assert.equal(big.status, 413);
    const noJd = await alice.post("/api/analyses").set(CSRF).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(noJd.status, 422);
  });

  it("lists history and returns the latest", async () => {
    const list = await alice.get("/api/analyses");
    assert.equal(list.body.analyses.length, 2);
    const latest = await alice.get("/api/analyses/latest");
    assert.ok(latest.body.result);
  });

  it("isolates users from each other's analyses", async () => {
    assert.equal((await bob.get(`/api/analyses/${analysisId}`)).status, 404);
    assert.equal((await bob.delete(`/api/analyses/${analysisId}`).set(CSRF)).status, 404);
    assert.equal((await bob.get("/api/analyses")).body.analyses.length, 0);
    assert.equal((await alice.get(`/api/analyses/${analysisId}`)).status, 200);
    assert.equal((await alice.get("/api/analyses/not-a-uuid")).status, 400);
  });

  it("answers assistant questions from the user's own analysis", async () => {
    const res = await alice.post("/api/assistant/chat").set(CSRF).send({ question: "What should I improve first?" });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, "rules");
    assert.match(res.body.content, /Kubernetes/);
    const other = await bob.post("/api/assistant/chat").set(CSRF).send({ question: "x", analysisId });
    assert.equal(other.status, 404);
  });

  it("deletes an analysis", async () => {
    assert.equal((await alice.delete(`/api/analyses/${analysisId}`).set(CSRF)).status, 204);
    assert.equal((await alice.get(`/api/analyses/${analysisId}`)).status, 404);
  });
});
