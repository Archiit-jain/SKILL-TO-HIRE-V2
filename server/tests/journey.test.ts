// End-to-end user journey through the HTTP API (hackathon release), with synthetic documents and a fake mailer:
// sample analysis -> guest analysis -> second guest analysis blocked -> sign-up and verification -> guest result claimed
// -> re-analysis -> progress history -> rules assistant with evidence -> delete an analysis -> delete the account.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import request from "supertest";
import { analyseAs, count, CSRF, loginDevice, testApp } from "./helpers.js";
import { SAMPLE_JD, SAMPLE_RESUME } from "./fixtures.js";

const IMPROVED_RESUME = SAMPLE_RESUME.replace(
  "• Built machine learning models with scikit-learn to predict customer churn",
  "• Built machine learning models with scikit-learn to predict customer churn\n• Deployed the churn service with Docker on Kubernetes"
);

describe("user journey", () => {
  it("runs from the sample to a deleted account", async () => {
    const ctx = await testApp();
    const browser = request.agent(ctx.app);

    // 1. The sample analysis needs no account and stores nothing.
    const sample = await browser.get("/api/demo/analysis");
    assert.equal(sample.status, 200);
    assert.equal(sample.body.result.demo, true);

    // 2. One free guest analysis, with evidence-rich results.
    const guest = await analyseAs(browser);
    assert.equal(guest.status, 201, JSON.stringify(guest.body));
    const first = guest.body.result;
    assert.equal(guest.body.guest, true);
    assert.ok(first.recommendations.length > 0);
    assert.ok(first.roadmap.length > 0);
    assert.equal(first.missingSkills.find((s: { skill: string }) => s.skill === "Kubernetes").status, "missing");
    assert.equal((await browser.get("/api/analyses/latest")).body.result.id, first.id, "results survive a refresh");

    // 3. A second guest analysis is refused.
    const second = await analyseAs(browser);
    assert.equal(second.status, 401);
    assert.equal(second.body.error.code, "login_required");

    // 4. Sign up in the same browser and verify: the guest result moves into the account.
    const signup = await browser.post("/api/auth/signup").set(CSRF).send({ name: "Journey Tester", email: "journey@example.com", password: "journey-pass-1" });
    assert.equal(signup.status, 201);
    const verified = await browser.post("/api/auth/verify-email").set(CSRF).send({ token: ctx.tokenFor("journey@example.com") });
    assert.equal(verified.status, 200);
    const history = await browser.get("/api/analyses");
    assert.deepEqual(history.body.analyses.map((a: { id: string }) => a.id), [first.id]);
    assert.equal(await count(ctx.db, "SELECT COUNT(*) AS n FROM guest_analyses"), 0, "claimed guest content is removed");

    // 5. Improve the resume and re-analyse the same job description: the score and ratings move.
    const again = await analyseAs(browser, IMPROVED_RESUME, SAMPLE_JD);
    assert.equal(again.status, 201, JSON.stringify(again.body));
    const improved = again.body.result;
    assert.ok(improved.overallScore > first.overallScore, `${improved.overallScore} > ${first.overallScore}`);
    assert.equal(improved.strongSkills.some((s: { skill: string }) => s.skill === "Kubernetes"), true);

    // 6. Progress history lists both analyses for the role, newest first.
    const progress = (await browser.get("/api/analyses")).body.analyses;
    assert.deepEqual(progress.map((a: { id: string }) => a.id), [improved.id, first.id]);
    assert.ok(progress.every((a: { jdTitle: string }) => a.jdTitle === "Data Engineer"));

    // 7. The assistant answers from the stored evidence (rules mode: no Gemini configured in tests).
    const chat = await browser.post("/api/assistant/chat").set(CSRF).send({ question: "Why is Docker partial?", analysisId: first.id });
    assert.equal(chat.status, 200);
    assert.equal(chat.body.mode, "rules");
    assert.match(chat.body.content, /Resume evidence used/);

    // 8. A second device sees the same saved data (persistence is server-side, not per browser).
    const phone = await loginDevice(ctx, "journey@example.com", "journey-pass-1");
    assert.equal((await phone.get("/api/analyses")).body.analyses.length, 2);

    // 9. Delete one analysis, then the account; nothing of the account remains.
    assert.equal((await browser.delete(`/api/analyses/${first.id}`).set(CSRF)).status, 204);
    assert.equal((await browser.get(`/api/analyses/${first.id}`)).status, 404);
    assert.equal((await browser.delete("/api/account").set(CSRF).send({ currentPassword: "journey-pass-1" })).status, 204);
    assert.equal((await phone.get("/api/analyses")).status, 401, "other sessions end with the account");
    for (const table of ["users", "analyses", "sessions", "email_verifications", "assistant_usage"]) {
      assert.equal(await count(ctx.db, `SELECT COUNT(*) AS n FROM ${table}`), 0, table);
    }
  });
});
