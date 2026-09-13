import { Router } from "express";
import { z } from "zod";
import { answer } from "../assistant/engine.js";
import { config } from "../config.js";
import type { Db } from "../db.js";
import { handler, HttpError, parseBody } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import { assistantLimiter } from "../middleware/security.js";
import { loadAnalysis } from "./analyses.js";

export function assistantRouter(db: Db) {
  const router = Router();
  router.use(requireAuth(db));

  router.get("/status", (_req, res) => {
    res.json({ mode: config.gemini ? "gemini" : "rules" });
  });

  router.post(
    "/chat",
    assistantLimiter,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({
          question: z.string().trim().min(1, "Ask a question").max(config.text.maxQuestionChars),
          analysisId: z.uuid().optional(),
        }),
        req.body
      );
      const result = loadAnalysis(db, req.user!.id, body.analysisId);
      if (body.analysisId && !result) throw new HttpError(404, "Analysis not found", "not_found");
      res.json(await answer(body.question, result));
    })
  );

  return router;
}
