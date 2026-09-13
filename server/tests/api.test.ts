import assert from "node:assert/strict";
import { before, describe, it } from "node:test";
import request from "supertest";
import { createApp } from "../src/app.js";
import { config } from "../src/config.js";
import { openDb } from "../src/db.js";
import { MemoryMailer } from "../src/email/mailer.js";
import type { GoogleIdentity } from "../src/security/google.js";
import { makePdf, SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";

const CSRF = { "X-Requested-With": "skill2hire" };

type Agent = ReturnType<typeof request.agent>;

/** Fake Google verifier: a credential "google:<sub>:<email>[:unverified]" is accepted. */
async function fakeGoogle(credential: string): Promise<GoogleIdentity | null> {
  const m = credential.match(/^google:([^:]+):([^:]+)(:unverified)?:padding-to-min-length$/);
  return m ? { sub: m[1], email: m[2], emailVerified: !m[3], name: "Google User" } : null;
}
const googleCredential = (sub: string, email: string, unverified = false) =>
  `google:${sub}:${email}${unverified ? ":unverified" : ""}:padding-to-min-length`;

function newApp() {
  const mailer = new MemoryMailer();
  const app = createApp(openDb(":memory:"), { mailer, verifyGoogle: fakeGoogle, googleClientId: "test-client-id.apps.googleusercontent.com" });
  /** Token from the most recent verification email sent to this address. */
  const tokenFor = (email: string) => {
    const msg = [...mailer.outbox].reverse().find((m) => m.to === email);
    const token = msg?.text.match(/\?verify=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, `no verification email for ${email}`);
    return decodeURIComponent(token);
  };
  return { app, mailer, tokenFor };
}

/** Sign up + verify email; returns an agent holding a session. */
async function verifiedUser(ctx: ReturnType<typeof newApp>, email = "student@example.com", password = "correct-horse-1"): Promise<Agent> {
  const agent = request.agent(ctx.app);
  const res = await agent.post("/api/auth/signup").set(CSRF).send({ name: "Test Student", email, password });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const v = await agent.post("/api/auth/verify-email").set(CSRF).send({ token: ctx.tokenFor(email) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return agent;
}

describe("auth: sign-up and email verification", () => {
  const ctx = newApp();
  const { app } = ctx;

  it("creates an unverified account, sends a link, and does not start a session", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/signup").set(CSRF).send({ name: "A", email: "A@Example.com", password: "password-123" });
    assert.equal(res.status, 201);
    assert.deepEqual(res.body, { verificationRequired: true, email: "a@example.com" });
    assert.equal(res.headers["set-cookie"], undefined);
    assert.equal((await agent.get("/api/auth/me")).status, 401);
    const mail = ctx.mailer.outbox.at(-1)!;
    assert.equal(mail.to, "a@example.com");
    assert.ok(mail.text.includes(`${config.appOrigin}/?verify=`), "link uses the configured origin, not request headers");
  });

  it("blocks login until the email is verified", async () => {
    const res = await request(app).post("/api/auth/login").set(CSRF).send({ email: "a@example.com", password: "password-123" });
    assert.equal(res.status, 403);
    assert.equal(res.body.error.code, "email_not_verified");
  });

  it("verifies with the emailed token, starts a hardened session, and the token is single-use", async () => {
    const token = ctx.tokenFor("a@example.com");
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/verify-email").set(CSRF).send({ token });
    assert.equal(res.status, 200);
    const cookie = String(res.headers["set-cookie"]);
    assert.match(cookie, /HttpOnly/);
    assert.match(cookie, /SameSite=Strict/);
    assert.equal((await agent.get("/api/auth/me")).body.user.emailVerified, true);
    const again = await request(app).post("/api/auth/verify-email").set(CSRF).send({ token });
    assert.equal(again.status, 400);
    const login = await request(app).post("/api/auth/login").set(CSRF).send({ email: "a@example.com", password: "password-123" });
    assert.equal(login.status, 200);
  });

  it("rejects forged and expired verification tokens", async () => {
    const forged = await request(app).post("/api/auth/verify-email").set(CSRF).send({ token: "x".repeat(43) });
    assert.equal(forged.status, 400);

    await request(app).post("/api/auth/signup").set(CSRF).send({ name: "E", email: "old@example.com", password: "password-123" });
    const oldToken = ctx.tokenFor("old@example.com");
    const realNow = Date.now;
    Date.now = () => realNow() + (config.emailVerificationTtlSeconds + 60) * 1000; // jump past the link's expiry
    try {
      const res = await request(app).post("/api/auth/verify-email").set(CSRF).send({ token: oldToken });
      assert.equal(res.status, 400);
    } finally {
      Date.now = realNow;
    }
  });

  it("rejects disposable email domains and malformed input", async () => {
    const temp = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "T", email: "someone@mailinator.com", password: "password-123" });
    assert.equal(temp.status, 422);
    assert.equal(temp.body.error.code, "disposable_email");
    const yop = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "T", email: "x@yopmail.com", password: "password-123" });
    assert.equal(yop.status, 422);
    const weak = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "B", email: "b@example.com", password: "short" });
    assert.equal(weak.status, 400);
    const bad = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "B", email: "not-an-email", password: "password-123" });
    assert.equal(bad.status, 400);
  });

  it("rejects domains that fail the mail-server check", async () => {
    const strict = newApp();
    const app2 = createApp(openDb(":memory:"), {
      mailer: strict.mailer,
      checkEmail: async () => ({ ok: false, code: "email_domain_invalid", message: "no mail server" }),
    });
    const res = await request(app2).post("/api/auth/signup").set(CSRF).send({ name: "N", email: "x@nomail.invalid", password: "password-123" });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "email_domain_invalid");
    assert.equal(strict.mailer.outbox.length, 0);
  });

  it("reports duplicates and answers resend requests without revealing accounts", async () => {
    const dup = await request(app).post("/api/auth/signup").set(CSRF).send({ name: "B", email: "a@example.com", password: "password-123" });
    assert.equal(dup.status, 409);

    const before = ctx.mailer.outbox.length;
    const unknown = await request(app).post("/api/auth/resend-verification").set(CSRF).send({ email: "ghost@example.com" });
    const verified = await request(app).post("/api/auth/resend-verification").set(CSRF).send({ email: "a@example.com" });
    assert.equal(unknown.status, 202);
    assert.equal(verified.status, 202);
    assert.equal(unknown.body.message, verified.body.message);
    assert.equal(ctx.mailer.outbox.length, before, "no email for unknown or already-verified accounts");
  });

  it("rate-limits resends with a cooldown", async () => {
    await request(app).post("/api/auth/signup").set(CSRF).send({ name: "C", email: "cool@example.com", password: "password-123" });
    const count = () => ctx.mailer.outbox.filter((m) => m.to === "cool@example.com").length;
    assert.equal(count(), 1);
    await request(app).post("/api/auth/resend-verification").set(CSRF).send({ email: "cool@example.com" });
    assert.equal(count(), 1, "resend inside the cooldown does not send");
  });

  it("disables email sign-up when no mail delivery is configured", async () => {
    const noMail = createApp(openDb(":memory:"), {
      mailer: { canDeliver: false, send: async () => { throw new Error("off"); } },
    });
    const providers = await request(noMail).get("/api/auth/providers");
    assert.equal(providers.body.emailSignup, false);
    const res = await request(noMail).post("/api/auth/signup").set(CSRF).send({ name: "N", email: "n@example.com", password: "password-123" });
    assert.equal(res.status, 503);
  });
});

describe("auth: login and session security", () => {
  const ctx = newApp();
  const { app } = ctx;
  before(async () => {
    await verifiedUser(ctx, "a@example.com", "password-123");
  });

  it("uses a generic login error and never accepts a wrong password", async () => {
    const wrong = await request(app).post("/api/auth/login").set(CSRF).send({ email: "a@example.com", password: "nope-nope-nope" });
    const unknown = await request(app).post("/api/auth/login").set(CSRF).send({ email: "ghost@example.com", password: "nope-nope-nope" });
    assert.equal(wrong.status, 401);
    assert.equal(unknown.status, 401);
    assert.equal(wrong.body.error.message, unknown.body.error.message);
    const ok = await request(app).post("/api/auth/login").set(CSRF).send({ email: "a@example.com", password: "password-123" });
    assert.equal(ok.status, 200);
    assert.ok(!JSON.stringify(ok.body).includes("password_hash"));
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

  it("sets security headers, including Google-compatible CSP", async () => {
    const res = await request(app).get("/api/health");
    assert.equal(res.headers["x-content-type-options"], "nosniff");
    assert.match(res.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.match(res.headers["content-security-policy"], /accounts\.google\.com\/gsi\/client/);
    assert.equal(res.headers["cross-origin-opener-policy"], "same-origin-allow-popups");
    assert.equal(res.headers["x-powered-by"], undefined);
  });
});

describe("auth: Google sign-in", () => {
  const ctx = newApp();
  const { app } = ctx;

  it("creates a verified, password-less account and starts a session", async () => {
    const agent = request.agent(app);
    const res = await agent.post("/api/auth/google").set(CSRF).send({ credential: googleCredential("sub-1", "g@example.com") });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(res.body.user, { name: "Google User", email: "g@example.com", hasPassword: false, googleLinked: true, emailVerified: true });
    assert.equal((await agent.get("/api/auth/me")).status, 200);
    // Same Google account again -> same user
    const again = await request(app).post("/api/auth/google").set(CSRF).send({ credential: googleCredential("sub-1", "g@example.com") });
    assert.equal(again.status, 200);
  });

  it("rejects invalid tokens and unverified Google emails", async () => {
    const bad = await request(app).post("/api/auth/google").set(CSRF).send({ credential: "definitely-not-a-google-token" });
    assert.equal(bad.status, 401);
    const unverified = await request(app).post("/api/auth/google").set(CSRF).send({ credential: googleCredential("sub-2", "u@example.com", true) });
    assert.equal(unverified.status, 403);
  });

  it("password login is impossible for Google-only accounts", async () => {
    // "!" is the stored no-password marker; it must never work as a password.
    for (const password of ["!", "anything-at-all"]) {
      const res = await request(app).post("/api/auth/login").set(CSRF).send({ email: "g@example.com", password });
      assert.equal(res.status, 401);
    }
  });

  it("links to an existing verified account with the same email", async () => {
    await verifiedUser(ctx, "both@example.com", "password-123");
    const res = await request(app).post("/api/auth/google").set(CSRF).send({ credential: googleCredential("sub-3", "both@example.com") });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.hasPassword, true);
    assert.equal(res.body.user.googleLinked, true);
    const pw = await request(app).post("/api/auth/login").set(CSRF).send({ email: "both@example.com", password: "password-123" });
    assert.equal(pw.status, 200, "password still works after linking");
  });

  it("takes over an unverified pre-registration safely (squatter's password is removed)", async () => {
    await request(app).post("/api/auth/signup").set(CSRF).send({ name: "Squatter", email: "victim@example.com", password: "squatter-pass-1" });
    const res = await request(app).post("/api/auth/google").set(CSRF).send({ credential: googleCredential("sub-4", "victim@example.com") });
    assert.equal(res.status, 200);
    assert.equal(res.body.user.hasPassword, false);
    const squat = await request(app).post("/api/auth/login").set(CSRF).send({ email: "victim@example.com", password: "squatter-pass-1" });
    assert.equal(squat.status, 401);
    const oldToken = ctx.tokenFor("victim@example.com");
    const v = await request(app).post("/api/auth/verify-email").set(CSRF).send({ token: oldToken });
    assert.equal(v.status, 400, "the squatter's pending verification link is revoked");
  });

  it("lets a Google-only user set a password and delete the account with confirmation", async () => {
    const agent = request.agent(app);
    await agent.post("/api/auth/google").set(CSRF).send({ credential: googleCredential("sub-5", "setpw@example.com") });
    const set = await agent.put("/api/account/password").set(CSRF).send({ newPassword: "brand-new-pass" });
    assert.equal(set.status, 204);
    const login = await request(app).post("/api/auth/login").set(CSRF).send({ email: "setpw@example.com", password: "brand-new-pass" });
    assert.equal(login.status, 200);

    const agent2 = request.agent(app);
    await agent2.post("/api/auth/google").set(CSRF).send({ credential: googleCredential("sub-6", "del@example.com") });
    assert.equal((await agent2.delete("/api/account").set(CSRF).send({})).status, 400);
    assert.equal((await agent2.delete("/api/account").set(CSRF).send({ confirm: "DELETE" })).status, 204);
  });
});

describe("account", () => {
  const ctx = newApp();
  const { app } = ctx;

  it("changes password, revoking the old session", async () => {
    const agent = await verifiedUser(ctx);
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

  it("requires the password to change email, re-verifies the new email, and blocks disposable ones", async () => {
    const agent = await verifiedUser(ctx, "second@example.com");
    const noPw = await agent.patch("/api/account").set(CSRF).send({ name: "X", email: "new@example.com" });
    assert.equal(noPw.status, 403);
    const temp = await agent.patch("/api/account").set(CSRF).send({ name: "X", email: "x@mailinator.com", currentPassword: "correct-horse-1" });
    assert.equal(temp.status, 422);
    const rename = await agent.patch("/api/account").set(CSRF).send({ name: "Renamed", email: "second@example.com" });
    assert.equal(rename.status, 200);
    assert.equal(rename.body.user.name, "Renamed");

    const change = await agent.patch("/api/account").set(CSRF).send({ name: "Renamed", email: "third@example.com", currentPassword: "correct-horse-1" });
    assert.equal(change.status, 200);
    assert.equal(change.body.verificationSent, true);
    assert.equal(change.body.user.emailVerified, false);
    const login = await request(app).post("/api/auth/login").set(CSRF).send({ email: "third@example.com", password: "correct-horse-1" });
    assert.equal(login.status, 403, "new email must be verified before the next login");
    const v = await request(app).post("/api/auth/verify-email").set(CSRF).send({ token: ctx.tokenFor("third@example.com") });
    assert.equal(v.status, 200);
  });

  it("persists settings and deletes the account with the password", async () => {
    const agent = await verifiedUser(ctx, "fourth@example.com");
    const settings = await agent.put("/api/account/settings").set(CSRF).send({ privacyMode: false, notifications: false });
    assert.equal(settings.status, 200);
    assert.deepEqual((await agent.get("/api/account/settings")).body, { privacyMode: false, notifications: false });

    assert.equal((await agent.delete("/api/account").set(CSRF).send({ currentPassword: "wrong" })).status, 403);
    assert.equal((await agent.delete("/api/account").set(CSRF).send({ currentPassword: "correct-horse-1" })).status, 204);
    assert.equal((await agent.get("/api/auth/me")).status, 401);
  });
});

describe("guest analysis", () => {
  const ctx = newApp();
  const { app } = ctx;

  it("allows exactly one analysis per browser without an account", async () => {
    const guest = request.agent(app);
    const first = await guest.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", makePdf(SAMPLE_RESUME), "Priya.pdf");
    assert.equal(first.status, 201, JSON.stringify(first.body));
    assert.equal(first.body.guest, true);
    assert.equal(first.body.result.resumeName, "resume.pdf", "guests always get privacy mode");
    assert.match(String(first.headers["set-cookie"]), /s2h_guest=.*HttpOnly/);

    const latest = await guest.get("/api/analyses/latest");
    assert.equal(latest.body.result.id, first.body.result.id);

    const second = await guest.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(second.status, 401);
    assert.equal(second.body.error.code, "login_required");

    // A different browser (no cookie) gets its own free analysis
    const otherBrowser = await request(app).post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(otherBrowser.status, 201);
  });

  it("keeps history, assistant and single-analysis routes behind login", async () => {
    const guest = request.agent(app);
    assert.equal((await guest.get("/api/analyses")).status, 401);
    assert.equal((await guest.post("/api/assistant/chat").set(CSRF).send({ question: "hi" })).status, 401);
    assert.equal((await guest.get("/api/analyses/latest")).body.result, null);
  });

  it("moves the guest result into the account after sign-in, and the free use stays consumed", async () => {
    const browser = request.agent(app);
    const first = await browser.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(first.status, 201);

    await browser.post("/api/auth/signup").set(CSRF).send({ name: "Guest Convert", email: "convert@example.com", password: "password-123" });
    const v = await browser.post("/api/auth/verify-email").set(CSRF).send({ token: ctx.tokenFor("convert@example.com") });
    assert.equal(v.status, 200);

    const history = await browser.get("/api/analyses");
    assert.equal(history.body.analyses.length, 1);
    assert.equal(history.body.analyses[0].id, first.body.result.id);

    const asUser = await browser.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(asUser.status, 201, "signed-in users are not limited");

    await browser.post("/api/auth/logout").set(CSRF);
    const afterLogout = await browser.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", makePdf(SAMPLE_RESUME), "cv.pdf");
    assert.equal(afterLogout.status, 401, "logging out does not grant another free analysis");
  });
});

describe("analyses (signed in)", () => {
  const ctx = newApp();
  const { app } = ctx;
  let alice: Agent;
  let bob: Agent;
  let analysisId = "";

  before(async () => {
    alice = await verifiedUser(ctx, "alice@example.com");
    bob = await verifiedUser(ctx, "bob@example.com");
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
    assert.equal(res.body.guest, undefined);
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
    const big = await alice.post("/api/analyses").set(CSRF).field("jdText", SAMPLE_JD).attach("resume", Buffer.alloc(config.upload.maxBytes + 1, 0x25), "cv.pdf");
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
