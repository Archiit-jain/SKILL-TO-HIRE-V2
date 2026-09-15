import { Router } from "express";
import multer from "multer";
import { z } from "zod";
import { analyze } from "../analysis/analyze.js";
import { assertTextWithinLimit, documentTooLong, JD_TOO_LONG_MESSAGE, RESUME_TOO_LONG_MESSAGE, type DocKind } from "../analysis/extract.js";
import { serverBusy } from "../analysis/parse-slots.js";
import { safeFilename } from "../analysis/redact.js";
import type { AnalysisResult } from "../analysis/types.js";
import { config } from "../config.js";
import type { Db } from "../db.js";
import type { AppDeps } from "../deps.js";
import { handler, HttpError, parseBody } from "../http.js";
import { optionalAuth, requireAuth } from "../middleware/auth.js";
import { ensureGuestId, guestHasUsedFreeAnalysis, latestGuestResult, purgeExpiredGuestData, readGuestId, recordGuestAnalysis } from "../security/guest.js";

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

const LOGIN_REQUIRED = "You've used your free analysis. Log in or create an account to run more analyses.";

export function analysesRouter(db: Db, deps: Pick<AppDeps, "parseSlots" | "documentParser" | "parseTimeoutMs" | "ipLimiters">) {
  const router = Router();
  const auth = requireAuth(db);

  // user_id is always part of the WHERE clause so one user can never read another user's analysis (no IDOR).

  router.post(
    "/",
    deps.ipLimiters.analysis,
    optionalAuth(db),
    // Guests get one analysis per browser (free-use marker, D-6). Checked before the upload is parsed so blocked
    // requests stay cheap; expired guest data is purged on the way.
    handler(async (req, _res, next) => {
      if (req.user) return next();
      await purgeExpiredGuestData(db);
      const guestId = readGuestId(req);
      if (guestId && (await guestHasUsedFreeAnalysis(db, guestId))) return next(new HttpError(401, LOGIN_REQUIRED, "login_required"));
      next();
    }),
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
          // Length is checked below (422 document_too_long, D-4); multer's fieldSize still bounds the raw field.
          jdText: z.string().optional(),
          jdTitle: z.string().trim().max(120).optional(),
        }),
        req.body ?? {}
      );
      if (!resume) throw new HttpError(400, "Resume file is required", "validation");
      // D-4: pasted JD over the limit is rejected before any parsing (counted on the trimmed text that is analysed).
      if ((body.jdText?.trim().length ?? 0) > config.text.maxJdChars) throw documentTooLong(JD_TOO_LONG_MESSAGE);

      const resumeName = safeFilename(Buffer.from(resume.originalname, "latin1").toString("utf8"));
      // D-5: extraction and analysis run inside a parse slot; when all slots are busy -> 503 server_busy + Retry-After.
      // A refused request stores nothing, so a guest's free analysis is not used up.
      if (!deps.parseSlots.tryAcquire()) throw serverBusy();
      // D-11 (P2): one deadline for all documents of this request. The slot is released only after every document's
      // parsing has really stopped (finished, or its parse worker was terminated at the deadline).
      const deadline = Date.now() + deps.parseTimeoutMs;
      const pending: Promise<void>[] = [];
      const extractText = (buffer: Buffer, filename: string, allowed: DocKind[]) => {
        const job = deps.documentParser.extract({ buffer, filename, allowed }, deadline);
        pending.push(job.settled);
        return job.text;
      };
      const result = await (async () => {
        const resumeText = assertTextWithinLimit(
          await extractText(resume.buffer, resumeName, ["pdf", "docx"]),
          config.upload.maxExtractedChars,
          RESUME_TOO_LONG_MESSAGE
        );
        if (resumeText.length < config.text.minResumeChars) {
          throw new HttpError(422, "Could not find enough text in the resume. Scanned/image-only PDFs are not supported.", "empty_text");
        }

        let jdText = body.jdText?.trim() ?? "";
        if (!jdText && jdFile) {
          const jdName = safeFilename(Buffer.from(jdFile.originalname, "latin1").toString("utf8"));
          jdText = assertTextWithinLimit(
            await extractText(jdFile.buffer, jdName, ["pdf", "docx", "txt"]),
            config.text.maxJdChars,
            JD_TOO_LONG_MESSAGE
          );
        }
        if (jdText.length < config.text.minJdChars) {
          throw new HttpError(422, "Please provide a longer job description (paste it or upload a file).", "empty_text");
        }

        return analyze({
          resumeText,
          jdText,
          resumeName,
          jdTitle: body.jdTitle,
          // Guests always get privacy mode (redacted contact details, anonymised file name).
          privacyMode: req.user ? !!req.user.privacy_mode : true,
        });
      })().finally(() => {
        void Promise.all(pending).then(() => deps.parseSlots.release());
      });

      if (!req.user) {
        const guestId = ensureGuestId(req, res);
        // Marker + result are written atomically; a parallel request from the same browser gets login_required.
        if (!(await recordGuestAnalysis(db, guestId, result.id, JSON.stringify(result), result.analyzedAt))) {
          throw new HttpError(401, LOGIN_REQUIRED, "login_required");
        }
        return res.status(201).json({ result, guest: true });
      }

      await db.run(
        `INSERT INTO analyses
          (id, user_id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, result_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
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

  router.get(
    "/",
    auth,
    handler(async (req, res) => {
    const rows = await db.all<Omit<AnalysisRow, "result_json">>(
      "SELECT id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, created_at FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 100",
      req.user!.id
    );
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
    })
  );

  /** Latest analysis for the signed-in user, or this browser's free guest analysis. */
  router.get(
    "/latest",
    optionalAuth(db),
    handler(async (req, res) => {
      const guestId = readGuestId(req);
      const json = req.user
        ? ((await db.get<{ result_json: string }>("SELECT result_json FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", req.user.id))
            ?.result_json ?? null)
        : guestId
          ? await latestGuestResult(db, guestId) // unclaimed and at most 30 days old (D-6)
          : null;
      res.json({ result: json ? (JSON.parse(json) as AnalysisResult) : null });
    })
  );

  router.get(
    "/:id",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(idParam, req.params);
      const row = await db.get<{ result_json: string }>("SELECT result_json FROM analyses WHERE id = ? AND user_id = ?", id, req.user!.id);
      if (!row) throw new HttpError(404, "Analysis not found", "not_found");
      res.json({ result: JSON.parse(row.result_json) as AnalysisResult });
    })
  );

  router.delete(
    "/:id",
    auth,
    handler(async (req, res) => {
      const { id } = parseBody(idParam, req.params);
      const info = await db.run("DELETE FROM analyses WHERE id = ? AND user_id = ?", id, req.user!.id);
      if (!info.changes) throw new HttpError(404, "Analysis not found", "not_found");
      res.status(204).end();
    })
  );

  return router;
}

export async function loadAnalysis(db: Db, userId: string, id?: string): Promise<AnalysisResult | null> {
  const row = id
    ? await db.get<{ result_json: string }>("SELECT result_json FROM analyses WHERE id = ? AND user_id = ?", id, userId)
    : await db.get<{ result_json: string }>("SELECT result_json FROM analyses WHERE user_id = ? ORDER BY created_at DESC LIMIT 1", userId);
  return row ? (JSON.parse(row.result_json) as AnalysisResult) : null;
}
