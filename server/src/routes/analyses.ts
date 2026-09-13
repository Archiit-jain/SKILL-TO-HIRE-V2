import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { analyze } from "../analysis/analyze.js";
import { extractText } from "../analysis/extract.js";
import { safeFilename } from "../analysis/redact.js";
import type { AnalysisResult } from "../analysis/types.js";
import { config } from "../config.js";
import type { Db } from "../db.js";
import { handler, HttpError, parseBody } from "../http.js";
import { requireAuth } from "../middleware/auth.js";
import { analysisLimiter } from "../middleware/security.js";

// Files stay in memory only; they are never written to disk.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: config.upload.maxBytes, files: 2, fields: 5, fieldSize: config.text.maxJdChars * 4, parts: 8 },
});

interface AnalysisRow {
  id: string;
  resume_name: string;
  jd_title: string;
  overall_score: number;
  strong_count: number;
  partial_count: number;
  missing_count: number;
  result_json: string;
  created_at: string;
}

const idParam = z.object({ id: z.uuid() });

export function analysesRouter(db: Db) {
  const router = Router();
  router.use(requireAuth(db));

  const insert = db.prepare(`INSERT INTO analyses
    (id, user_id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const listForUser = db.prepare(
    "SELECT id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 100"
  );
  const latestForUser = db.prepare("SELECT result_json FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1");
  // user_id is always part of the WHERE clause so one user can never read another user's analysis (no IDOR).
  const getForUser = db.prepare("SELECT result_json FROM analyses WHERE id = ? AND user_id = ?");
  const deleteForUser = db.prepare("DELETE FROM analyses WHERE id = ? AND user_id = ?");

  router.post(
    "/",
    analysisLimiter,
    upload.fields([
      { name: "resume", maxCount: 1 },
      { name: "jdFile", maxCount: 1 },
    ]),
    handler(async (req, res) => {
      const files = (req.files ?? {}) as Record<string, Express.Multer.File[] | undefined>;
      const resume = files.resume?.[0];
      const jdFile = files.jdFile?.[0];
      const body = parseBody(
        z.object({
          jdText: z.string().max(config.text.maxJdChars, "Job description is too long").optional(),
          jdTitle: z.string().trim().max(120).optional(),
        }),
        req.body ?? {}
      );
      if (!resume) throw new HttpError(400, "Resume file is required", "validation");

      const resumeName = safeFilename(Buffer.from(resume.originalname, "latin1").toString("utf8"));
      const resumeText = await extractText(resume.buffer, resumeName, ["pdf", "docx"]);
      if (resumeText.length < config.text.minResumeChars) {
        throw new HttpError(422, "Could not find enough text in the resume. Scanned/image-only PDFs are not supported.", "empty_text");
      }

      let jdText = body.jdText?.trim() ?? "";
      if (!jdText && jdFile) {
        const jdName = safeFilename(Buffer.from(jdFile.originalname, "latin1").toString("utf8"));
        jdText = await extractText(jdFile.buffer, jdName, ["pdf", "docx", "txt"]);
      }
      if (jdText.length < config.text.minJdChars) {
        throw new HttpError(422, "Please provide a longer job description (paste it or upload a file).", "empty_text");
      }

      const result = analyze({
        resumeText,
        jdText: jdText.slice(0, config.text.maxJdChars),
        resumeName,
        jdTitle: body.jdTitle,
        privacyMode: !!req.user!.privacy_mode,
      });

      insert.run(
        result.id,
        req.user!.id,
        result.resumeName,
        result.jdTitle,
        result.overallScore,
        result.strongSkills.length,
        result.partialSkills.length,
        result.missingSkills.length,
        JSON.stringify(result),
        result.analyzedAt
      );
      res.status(201).json({ result });
    })
  );

  router.get("/", (req, res) => {
    const rows = listForUser.all(req.user!.id) as unknown as Omit<AnalysisRow, "result_json">[];
    res.json({
      analyses: rows.map((r) => ({
        id: r.id,
        date: r.created_at,
        score: r.overall_score,
        jdTitle: r.jd_title,
        resumeName: r.resume_name,
        strongCount: r.strong_count,
        partialCount: r.partial_count,
        missingCount: r.missing_count,
      })),
    });
  });

  router.get("/latest", (req, res) => {
    const row = latestForUser.get(req.user!.id) as { result_json: string } | undefined;
    res.json({ result: row ? (JSON.parse(row.result_json) as AnalysisResult) : null });
  });

  router.get("/:id", (req, res) => {
    const { id } = parseBody(idParam, req.params);
    const row = getForUser.get(id, req.user!.id) as { result_json: string } | undefined;
    if (!row) throw new HttpError(404, "Analysis not found", "not_found");
    res.json({ result: JSON.parse(row.result_json) as AnalysisResult });
  });

  router.delete("/:id", (req, res) => {
    const { id } = parseBody(idParam, req.params);
    const info = deleteForUser.run(id, req.user!.id);
    if (!info.changes) throw new HttpError(404, "Analysis not found", "not_found");
    res.status(204).end();
  });

  return router;
}

export function loadAnalysis(db: Db, userId: string, id?: string): AnalysisResult | null {
  const row = (
    id
      ? db.prepare("SELECT result_json FROM analyses WHERE id = ? AND user_id = ?").get(id, userId)
      : db.prepare("SELECT result_json FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1").get(userId)
  ) as { result_json: string } | undefined;
  return row ? (JSON.parse(row.result_json) as AnalysisResult) : null;
}
