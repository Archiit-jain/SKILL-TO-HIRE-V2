import { Router } from "express";
import { z } from "zod";
import { answer } from "../assistant/engine.js";
import { config } from "../config.js";
import type { Db } from "../db.js";
import type { AppDeps } from "../deps.js";
import { handler, HttpError, parseBody } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import { rateLimited } from "../middleware/security.js";
import { loadAnalysis } from "./analyses.js";

export function assistantRouter(db: Db, deps: AppDeps) {
  const router = Router();
  router.use(requireAuth(db));

  router.get("/status", (_req, res) => {
    res.json({ mode: deps.gemini ? "gemini" : "rules" });
  });

  router.post(
    "/chat",
    deps.ipLimiters.assistant,
    handler(async (req, res) => {
      // D-8: at most 60 assistant requests per user per hour, on top of the per-IP limit and the Gemini daily quota.
      const waitSeconds = deps.assistantRequests.tryConsume(req.user!.id);
      if (waitSeconds !== null) throw rateLimited(waitSeconds);
      const body = parseBody(
        z.object({
          question: z.string().trim().min(1, "Ask a question").max(config.text.maxQuestionChars),
          analysisId: z.uuid().optional(),
        }),
        req.body
      );
      const result = loadAnalysis(db, req.user!.id, body.analysisId);
      if (body.analysisId && !result) throw new HttpError(404, "Analysis not found", "not_found");
      res.json(
        await answer(body.question, result, { db, userId: req.user!.id, gemini: deps.gemini, quota: deps.geminiQuota, now: deps.now() })
      );
    })
  );

  return router;
}
