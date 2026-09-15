// P2 hardening: split per-IP limiters (D-8), sign-up enumeration (D-10), /api/health exposure (L-4), CSP without
// 'unsafe-inline' styles, and log hygiene (L-5). Synthetic data only.
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, it } from "node:test";
import request from "supertest";
import { config, PROJECT_ROOT } from "../src/config.js";
import { accountExistsEmail, mailErrorCode } from "../src/email/mailer.js";
import { createIpLimiters, IP_LIMITS, RADIX_SCROLL_AREA_STYLE, RADIX_SCROLL_AREA_STYLE_HASH } from "../src/middleware/security.js";
import type { EmailCheckResult } from "../src/security/email-check.js";
import { CSRF, count, signedUpUser, testApp } from "./helpers.js";

const RATE_LIMITED = { error: { code: "rate_limited", message: "Too many requests, please try again later" } };

const enforced = () => testApp({ ipLimiters: createIpLimiters({ enabled: true }) });
const hit = (app: ReturnType<typeof testApp>["app"], route: string, body: object, headers: Record<string, string> = {}) =>
  request(app).post(`/api${route}`).set(CSRF).set(headers).send(body);

async function exhaust(app: ReturnType<typeof testApp>["app"], route: string, body: object, limit: number, headers?: Record<string, string>) {
  for (let i = 0; i < limit; i++) {
    const res = await hit(app, route, body, headers);
    assert.notEqual(res.status, 429, `request ${i + 1} of ${limit} to ${route} must not be limited`);
  }
  return hit(app, route, body, headers);
}

describe("P2 split per-IP rate limits (D-8)", () => {
  it("keeps the approved values", () => {
    assert.deepEqual(
      Object.fromEntries(Object.entries(IP_LIMITS).map(([k, v]) => [k, [v.limit, v.windowMs / 60_000]])),
      { api: [300, 15], login: [20, 15], signup: [5, 60], verification: [10, 15], google: [20, 15], account: [10, 15], analysis: [30, 60], assistant: [60, 60] }
    );
  });

  it("limits login to 20 per 15 min per IP, independently of sign-up", async () => {
    const { app } = enforced();
    // A different address each time, so the per-account limit (5 failures) doesn't fire first.
    for (let i = 0; i < 20; i++) {
      const res = await hit(app, "/auth/login", { email: `nobody${i}@example.com`, password: "wrong-password" });
      assert.equal(res.status, 401, `login ${i + 1}`);
    }
    const blocked = await hit(app, "/auth/login", { email: "another@example.com", password: "wrong-password" });
    assert.equal(blocked.status, 429);
    assert.deepEqual(blocked.body, RATE_LIMITED);
    assert.ok(blocked.headers["ratelimit-policy"] || blocked.headers["ratelimit"], "standard RateLimit headers are sent");
    const signup = await hit(app, "/auth/signup", { name: "N", email: "fresh@example.com", password: "password-123" });
    assert.notEqual(signup.status, 429, "sign-up has its own limiter");
  });

  it("limits sign-up to 5 per hour per IP", async () => {
    const { app } = enforced();
    const blocked = await exhaust(app, "/auth/signup", { name: "N", email: "x@example.com", password: "short" }, 5);
    assert.equal(blocked.status, 429);
  });

  it("shares 10 per 15 min between verify-email and resend-verification", async () => {
    const { app } = enforced();
    for (let i = 0; i < 5; i++) await hit(app, "/auth/verify-email", { token: "not-a-real-token-but-long-enough" });
    for (let i = 0; i < 5; i++) await hit(app, "/auth/resend-verification", { email: "someone@example.com" });
    assert.equal((await hit(app, "/auth/resend-verification", { email: "someone@example.com" })).status, 429);
    assert.equal((await hit(app, "/auth/verify-email", { token: "not-a-real-token-but-long-enough" })).status, 429);
  });

  it("limits Google sign-in to 20 per 15 min per IP", async () => {
    const { app } = enforced();
    const blocked = await exhaust(app, "/auth/google", { credential: "x".repeat(40) }, 20);
    assert.equal(blocked.status, 429);
  });

  it("limits analyses to 30 per hour per IP", async () => {
    const { app } = enforced();
    for (let i = 0; i < 30; i++) {
      const res = await request(app).post("/api/analyses").set(CSRF);
      assert.notEqual(res.status, 429);
    }
    assert.equal((await request(app).post("/api/analyses").set(CSRF)).status, 429);
  });

  it("ignores a spoofed X-Forwarded-For unless TRUST_PROXY is on", async () => {
    assert.equal(config.trustProxy, false);
    const { app } = enforced();
    for (let i = 0; i < 20; i++) {
      await hit(app, "/auth/login", { email: `spoof${i}@example.com`, password: "wrong-password" }, { "X-Forwarded-For": `203.0.113.${i}` });
    }
    const spoofed = await hit(app, "/auth/login", { email: "spoof-new@example.com", password: "wrong-password" }, { "X-Forwarded-For": "198.51.100.7" });
    assert.equal(spoofed.status, 429, "a new forwarded address doesn't reset the limit");
  });

  it("stays disabled for other tests unless enabled explicitly", async () => {
    const { app } = testApp();
    for (let i = 0; i < 25; i++) await hit(app, "/auth/login", { email: `open${i}@example.com`, password: "wrong-password" });
    assert.equal((await hit(app, "/auth/login", { email: "open-last@example.com", password: "wrong-password" })).status, 401);
  });
});

describe("P2 sign-up doesn't reveal registered emails (D-10)", () => {
  it("answers new, unverified and verified addresses identically and never changes an existing account", async () => {
    const ctx = testApp();
    await signedUpUser(ctx, "verified@example.com", "original-pass-1");
    const pending = await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "P", email: "pending@example.com", password: "pending-pass-1" });
    assert.equal(pending.status, 201);
    const before = ctx.db.prepare("SELECT * FROM users WHERE email = 'verified@example.com'").get();

    const outbox = ctx.mailer.outbox.length;
    const brandNew = await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "N", email: "brand-new@example.com", password: "password-123" });
    const againPending = await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "Q", email: "pending@example.com", password: "attacker-pass-1" });
    const againVerified = await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "Attacker", email: "verified@example.com", password: "attacker-pass-1" });

    for (const [res, email] of [[brandNew, "brand-new@example.com"], [againPending, "pending@example.com"], [againVerified, "verified@example.com"]] as const) {
      assert.equal(res.status, 201);
      assert.deepEqual(res.body, { verificationRequired: true, email });
    }
    assert.deepEqual(ctx.db.prepare("SELECT * FROM users WHERE email = 'verified@example.com'").get(), before, "existing account untouched");
    assert.equal(count(ctx.db, "SELECT COUNT(*) AS n FROM users WHERE email = 'pending@example.com'"), 1);

    const sent = ctx.mailer.outbox.slice(outbox);
    assert.equal(sent.find((m) => m.to === "brand-new@example.com")?.subject, "Verify your email for Skill2Hire");
    assert.equal(sent.find((m) => m.to === "verified@example.com")?.subject, "You already have a Skill2Hire account");
    assert.equal(sent.filter((m) => m.to === "pending@example.com").length, 0, "the unverified account's resend cooldown still applies");

    const login = await request(ctx.app).post("/api/auth/login").set(CSRF).send({ email: "verified@example.com", password: "original-pass-1" });
    assert.equal(login.status, 200, "the original password still works");
  });

  it("the existing-account notice contains no link that changes anything and escapes the name", () => {
    const mail = accountExistsEmail("<script>x</script>", "https://skill2hire.example");
    assert.ok(!mail.html.includes("<script>"));
    assert.ok(!/verify=|token=|reset/i.test(mail.text + mail.html));
    assert.match(mail.text, /Nothing about your account was changed/);
  });

  it("disposable addresses are still rejected before any account lookup", async () => {
    const checkEmail = async (): Promise<EmailCheckResult> => ({ ok: false, code: "disposable_email", message: "Temporary or disposable email addresses aren't allowed. Please use your real email." });
    const ctx = testApp({ checkEmail });
    const res = await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "N", email: "x@example.com", password: "password-123" });
    assert.equal(res.status, 422);
    assert.equal(res.body.error.code, "disposable_email");
  });
});

describe("P2 /api/health exposure (L-4)", () => {
  it("production answers only {status}", async () => {
    const res = await request(testApp({ healthDetails: false }).app).get("/api/health");
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, { status: "ok" });
  });

  it("development/test keep the diagnostic fields, and production is the default when isProd", async () => {
    const res = await request(testApp().app).get("/api/health");
    assert.deepEqual(Object.keys(res.body).sort(), ["assistant", "ephemeralStorage", "status"]);
    assert.equal(config.isProd, false);
  });
});

describe("P2 CSP without 'unsafe-inline' styles", () => {
  it("allows exactly Radix ScrollArea's inline style by hash, and nothing inline otherwise", async () => {
    const hash = `'sha256-${createHash("sha256").update(RADIX_SCROLL_AREA_STYLE).digest("base64")}'`;
    assert.equal(RADIX_SCROLL_AREA_STYLE_HASH, hash);
    const radixSource = readFileSync(path.join(PROJECT_ROOT, "node_modules", "@radix-ui", "react-scroll-area", "dist", "index.mjs"), "utf8");
    assert.ok(radixSource.includes(RADIX_SCROLL_AREA_STYLE), "the hashed style matches the installed Radix version");

    const csp = String((await request(testApp().app).get("/api/health")).headers["content-security-policy"]);
    const styleSrc = csp.split(";").map((d) => d.trim()).find((d) => d.startsWith("style-src "));
    assert.equal(styleSrc, `style-src 'self' ${hash} https://accounts.google.com/gsi/style`);
    assert.ok(!csp.includes("unsafe-inline"));
    assert.match(csp, /script-src 'self' https:\/\/accounts\.google\.com\/gsi\/client/);
    assert.match(csp, /frame-ancestors 'none'/);
    assert.match(csp, /object-src 'none'/);
  });

  it("the static-site CSP in vercel.json matches", () => {
    const vercel = JSON.parse(readFileSync(path.join(PROJECT_ROOT, "vercel.json"), "utf8"));
    const header = vercel.headers[0].headers.find((h: { key: string }) => h.key === "Content-Security-Policy").value as string;
    assert.ok(!header.includes("unsafe-inline"));
    assert.ok(header.includes(`style-src 'self' ${RADIX_SCROLL_AREA_STYLE_HASH} https://accounts.google.com/gsi/style`));
  });
});

describe("P2 log hygiene (L-5)", () => {
  const lines: string[] = [];
  const original = { log: console.log, warn: console.warn, error: console.error };
  const capture = () => {
    lines.length = 0;
    for (const k of ["log", "warn", "error"] as const) console[k] = (...args: unknown[]) => lines.push(args.map(String).join(" "));
  };
  afterEach(() => Object.assign(console, original));

  it("a mail transport error logs only its code", () => {
    assert.equal(mailErrorCode(Object.assign(new Error("550 rejected recipient victim@example.com"), { code: "EENVELOPE" })), "EENVELOPE");
    assert.equal(mailErrorCode(new Error("Invalid login: secret-app-password")), "send_failed");
    assert.equal(mailErrorCode({ code: "not a code with victim@example.com" }), "send_failed");
  });

  it("sign-up email failures, parser failures and unhandled errors don't log messages, emails or content", async () => {
    const failing = { canDeliver: true, send: async () => { throw Object.assign(new Error("550 mailbox victim@example.com unavailable"), { code: "EENVELOPE" }); } };
    const ctx = testApp({ mailer: failing });
    capture();
    const res = await request(ctx.app).post("/api/auth/signup").set(CSRF).send({ name: "Victim", email: "victim@example.com", password: "password-123" });
    assert.equal(res.status, 502);
    assert.equal(res.body.error.code, "email_send_failed");

    const { extractText } = await import("../src/analysis/extract.js");
    await assert.rejects(extractText(Buffer.from("%PDF-1.4\nSECRET RESUME CONTENT that is not a real pdf"), "cv.pdf", ["pdf"]));

    const joined = lines.join("\n");
    assert.match(joined, /\[auth\] sign-up email failed: EENVELOPE/);
    for (const leak of ["victim@example.com", "550", "SECRET RESUME CONTENT", "password-123"]) assert.ok(!joined.includes(leak), leak);
  });
});
