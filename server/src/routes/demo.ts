import { Router } from "express";
import { z } from "zod";
import { demoAnalysis } from "../analysis/demo.js";
import type { AnalysisResult } from "../analysis/types.js";
import { answerFromAnalysis } from "../assistant/engine.js";
import { config } from "../config.js";
import type { AppDeps } from "../deps.js";
import { handler, parseBody } from "../http.js";

/**
 * Sample analysis for visitors (hackathon release): the real engine run on built-in synthetic documents.
 * Nothing is uploaded or stored, no guest cookie is set, and the guest free analysis is not used.
 * The sample assistant is rules-only (Gemini is never called for it) and shares the per-IP assistant limit.
 */
export function demoRouter(deps: Pick<AppDeps, "ipLimiters">) {
  const router = Router();
  // The sample is deterministic (fixed documents and date), so it is computed once per instance.
  let cached: AnalysisResult | null = null;
  const sample = () => (cached ??= demoAnalysis());

  router.get("/analysis", (_req, res) => {
    res.json({ result: sample() });
  });

  router.post(
    "/assistant",
    deps.ipLimiters.assistant,
    handler((req, res) => {
      const body = parseBody(z.object({ question: z.string().trim().min(1, "Ask a question").max(config.text.maxQuestionChars) }), req.body);
      res.json(answerFromAnalysis(body.question, sample()));
    })
  );

  return router;
}
