// Demo endpoints (hackathon release): the sample analysis stores nothing, sets no cookies, doesn't use the guest free
// analysis, and its assistant is rules-only, validated, CSRF-protected and shares the per-IP assistant limit.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { demoAnalysis } from "../src/analysis/demo.js";
import type { GeminiPhraser } from "../src/assistant/gemini.js";
import { config } from "../src/config.js";
import { createIpLimiters } from "../src/middleware/security.js";
import { analyseAs, count, CSRF, testApp } from "./helpers.js";

describe("GET /api/demo/analysis", () => {
  it("returns the engine's sample analysis without storing anything or setting cookies", async () => {
    const ctx = await testApp();
    const res = await request(ctx.app).get("/api/demo/analysis");
    assert.equal(res.status, 200);
    assert.equal(res.body.result.demo, true);
    assert.equal(res.body.result.overallScore, demoAnalysis().overallScore);
    assert.equal(res.headers["set-cookie"], undefined);
    for (const table of ["analyses", "guest_analyses", "guest_free_use"]) {
      assert.equal(await count(ctx.db, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
    }
  });

  it("does not use up the guest's free analysis", async () => {
    const ctx = await testApp();
    const agent = request.agent(ctx.app);
    assert.equal((await agent.get("/api/demo/analysis")).status, 200);
    const real = await analyseAs(agent);
    assert.equal(real.status, 201, JSON.stringify(real.body));
    assert.equal(real.body.guest, true);
  });
});

describe("POST /api/demo/assistant", () => {
  it("answers from the sample with the rules engine and never calls Gemini", async () => {
    let calls = 0;
    const gemini: GeminiPhraser = {
      model: "fake-model",
      generate: async () => {
        calls++;
        return { text: "should not be used", finishReason: "STOP" };
      },
    };
    const ctx = await testApp({ gemini });
    const res = await request(ctx.app).post("/api/demo/assistant").set(CSRF).send({ question: "Why is Kubernetes missing?" });
    assert.equal(res.status, 200);
    assert.equal(res.body.mode, "rules");
    assert.match(res.body.content, /Kubernetes/);
    assert.match(res.body.content, /\*\*Missing\*\*/);
    assert.equal(calls, 0);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM assistant_usage_global"), 0, "no Gemini quota used");
  });

  it("validates the question and requires the CSRF header", async () => {
    const ctx = await testApp();
    const empty = await request(ctx.app).post("/api/demo/assistant").set(CSRF).send({ question: "   " });
    assert.equal(empty.status, 400);
    assert.equal(empty.body.error.code, "validation");
    const long = await request(ctx.app).post("/api/demo/assistant").set(CSRF).send({ question: "x".repeat(config.text.maxQuestionChars + 1) });
    assert.equal(long.status, 400);
    const noCsrf = await request(ctx.app).post("/api/demo/assistant").send({ question: "What should I improve?" });
    assert.equal(noCsrf.status, 403);
  });

  it("shares the 60 per hour per-IP assistant limit", async () => {
    const ctx = await testApp({ ipLimiters: createIpLimiters({ enabled: true }) });
    for (let i = 0; i < 60; i++) {
      const res = await request(ctx.app).post("/api/demo/assistant").set(CSRF).send({ question: "What should I improve?" });
      assert.equal(res.status, 200, `request ${i + 1}`);
    }
    const blocked = await request(ctx.app).post("/api/demo/assistant").set(CSRF).send({ question: "What should I improve?" });
    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error.code, "rate_limited");
  });
});
