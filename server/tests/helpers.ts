// Shared helpers for the security remediation P1 test files. Synthetic users only.
import assert from "node:assert/strict";
import request from "supertest";
import { createApp } from "../src/app.js";
import { openDb, type Db } from "../src/db.js";
import type { AppDeps } from "../src/deps.js";
import { MemoryMailer } from "../src/email/mailer.js";
import { makePdf, SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";

export const CSRF = { "X-Requested-With": "skill2hire" };
export type Agent = ReturnType<typeof request.agent>;

export interface TestApp {
  app: ReturnType<typeof createApp>;
  db: Db;
  mailer: MemoryMailer;
  tokenFor: (email: string) => string;
}

export function testApp(overrides: Partial<AppDeps> = {}): TestApp {
  const mailer = new MemoryMailer();
  const db = openDb(":memory:");
  const app = createApp(db, { mailer, ...overrides });
  const tokenFor = (email: string) => {
    const msg = [...mailer.outbox].reverse().find((m) => m.to === email);
    const token = msg?.text.match(/\?verify=([A-Za-z0-9_-]+)/)?.[1];
    assert.ok(token, `no verification email for ${email}`);
    return decodeURIComponent(token);
  };
  return { app, db, mailer, tokenFor };
}

/** Signs up and verifies an account; the returned agent holds a session. */
export async function signedUpUser(ctx: TestApp, email: string, password = "correct-horse-1", agent: Agent = request.agent(ctx.app)) {
  const res = await agent.post("/api/auth/signup").set(CSRF).send({ name: "Synthetic User", email, password });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const v = await agent.post("/api/auth/verify-email").set(CSRF).send({ token: ctx.tokenFor(email) });
  assert.equal(v.status, 200, JSON.stringify(v.body));
  return agent;
}

/** A second device: logs in with a fresh agent. */
export async function loginDevice(ctx: TestApp, email: string, password = "correct-horse-1") {
  const agent = request.agent(ctx.app);
  const res = await agent.post("/api/auth/login").set(CSRF).send({ email, password });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  return agent;
}

/** The raw s2h_session cookie from a response's Set-Cookie header. */
export function sessionCookie(res: request.Response): string {
  const header = ([] as string[]).concat(res.headers["set-cookie"] ?? []);
  const cookie = header.map((c) => c.match(/^s2h_session=[^;]*/)?.[0]).find((c) => c && c !== "s2h_session=");
  assert.ok(cookie, "response sets a session cookie");
  return cookie;
}

export const analyseAs = (agent: Agent | ReturnType<typeof request>, resume = SAMPLE_RESUME, jd = SAMPLE_JD) =>
  (agent as Agent).post("/api/analyses").set(CSRF).field("jdText", jd).attach("resume", makePdf(resume), "cv.pdf");

export const count = (db: Db, sql: string, ...params: Array<string | number>) => (db.prepare(sql).get(...params) as { n: number }).n;
