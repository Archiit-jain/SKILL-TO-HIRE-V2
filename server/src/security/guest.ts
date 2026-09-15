import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import type { Db } from "../db.js";

export const GUEST_COOKIE = "s2h_guest";

const DAY_MS = 24 * 3600 * 1000;

/** Opaque random id that lets a browser run one analysis without an account. Not a credential. */
export function readGuestId(req: Request): string | null {
  const v = req.cookies?.[GUEST_COOKIE];
  return typeof v === "string" && /^[a-f0-9]{48}$/.test(v) ? v : null;
}

export function ensureGuestId(req: Request, res: Response): string {
  const existing = readGuestId(req);
  if (existing) return existing;
  const id = randomBytes(24).toString("hex");
  res.cookie(GUEST_COOKIE, id, {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "strict",
    path: "/api",
    maxAge: 365 * 24 * 3600 * 1000,
  });
  return id;
}

// ---- Guest data lifecycle (security remediation P1, D-6) -----------------------------------------------------------
// guest_free_use marks "this browser has used its free analysis" (kept 365 days, no analysis content).
// guest_analyses holds an unclaimed guest result (kept 30 days) until the browser signs in, when it is moved into the
// account and deleted. Retention is enforced on normal guest requests; there is no background job.

/** ISO cut-off timestamps: results created before `analyses`, markers set before `freeUse`, have expired. */
export function guestCutoffs(now = new Date()) {
  return {
    analyses: new Date(now.getTime() - config.security.guestAnalysisRetentionDays * DAY_MS).toISOString(),
    freeUse: new Date(now.getTime() - config.security.guestFreeUseRetentionDays * DAY_MS).toISOString(),
  };
}

/** Deletes expired guest results (older than 30 days) and expired free-use markers (older than 365 days). */
export async function purgeExpiredGuestData(db: Db, now = new Date()) {
  const cutoff = guestCutoffs(now);
  await db.run("DELETE FROM guest_analyses WHERE created_at < ?", cutoff.analyses);
  await db.run("DELETE FROM guest_free_use WHERE used_at < ?", cutoff.freeUse);
}

/** True when this browser has used its free analysis within the marker retention period. */
export async function guestHasUsedFreeAnalysis(db: Db, guestId: string, now = new Date()): Promise<boolean> {
  return !!(await db.get("SELECT 1 AS ok FROM guest_free_use WHERE guest_id = ? AND used_at >= ?", guestId, guestCutoffs(now).freeUse));
}

/**
 * Atomically consumes the free analysis and stores the guest result. Returns false (nothing stored) when the marker
 * already exists, so two parallel requests from one browser can't both succeed: guest_id is the marker's primary key.
 */
export async function recordGuestAnalysis(
  db: Db,
  guestId: string,
  resultId: string,
  resultJson: string,
  createdAt: string,
  now = new Date()
): Promise<boolean> {
  return db.transaction(async (tx) => {
    // A marker past its retention no longer blocks a new free analysis; remove it so the primary key is free again.
    await tx.run("DELETE FROM guest_free_use WHERE guest_id = ? AND used_at < ?", guestId, guestCutoffs(now).freeUse);
    const marker = await tx.run("INSERT OR IGNORE INTO guest_free_use (guest_id, used_at) VALUES (?, ?)", guestId, createdAt);
    // Nothing else is written; the transaction commits only the (no-op) delete of an expired marker.
    if (!marker.changes) return false;
    await tx.run("INSERT INTO guest_analyses (id, guest_id, result_json, created_at) VALUES (?, ?, ?, ?)", resultId, guestId, resultJson, createdAt);
    return true;
  });
}

/** This browser's unexpired, unclaimed guest result (JSON), if any. */
export async function latestGuestResult(db: Db, guestId: string, now = new Date()): Promise<string | null> {
  await purgeExpiredGuestData(db, now);
  const row = await db.get<{ result_json: string }>(
    "SELECT result_json FROM guest_analyses WHERE guest_id = ? AND claimed_by IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 1",
    guestId,
    guestCutoffs(now).analyses
  );
  return row?.result_json ?? null;
}

/**
 * Moves this browser's unexpired guest results into the account that just signed in, then deletes them from
 * guest_analyses. The free-use marker stays, so the browser still counts as having used its free analysis.
 */
export async function claimGuestAnalyses(db: Db, req: Request, userId: string, now = new Date()) {
  const guestId = readGuestId(req);
  if (!guestId) return;
  await purgeExpiredGuestData(db, now);
  await db.transaction(async (tx) => {
    // Read inside the transaction so two parallel sign-ins can't both move the same result.
    const rows = await tx.all<{ id: string; result_json: string; created_at: string }>(
      "SELECT id, result_json, created_at FROM guest_analyses WHERE guest_id = ? AND claimed_by IS NULL AND created_at >= ?",
      guestId,
      guestCutoffs(now).analyses
    );
    for (const row of rows) {
      const r = JSON.parse(row.result_json);
      await tx.run(
        `INSERT OR IGNORE INTO analyses
          (id, user_id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, result_json, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        r.id,
        userId,
        r.resumeName,
        r.jdTitle,
        r.overallScore,
        r.strongSkills.length,
        r.partialSkills.length,
        r.missingSkills.length,
        row.result_json,
        row.created_at
      );
      await tx.run("INSERT OR IGNORE INTO guest_free_use (guest_id, used_at) VALUES (?, ?)", guestId, row.created_at);
      await tx.run("DELETE FROM guest_analyses WHERE id = ? AND guest_id = ?", row.id, guestId);
    }
  });
}
