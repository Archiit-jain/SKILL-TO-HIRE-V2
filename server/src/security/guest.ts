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
export function purgeExpiredGuestData(db: Db, now = new Date()) {
  const cutoff = guestCutoffs(now);
  db.prepare("DELETE FROM guest_analyses WHERE created_at < ?").run(cutoff.analyses);
  db.prepare("DELETE FROM guest_free_use WHERE used_at < ?").run(cutoff.freeUse);
}

/** True when this browser has used its free analysis within the marker retention period. */
export function guestHasUsedFreeAnalysis(db: Db, guestId: string, now = new Date()): boolean {
  return !!db.prepare("SELECT 1 FROM guest_free_use WHERE guest_id = ? AND used_at >= ?").get(guestId, guestCutoffs(now).freeUse);
}

/**
 * Atomically consumes the free analysis and stores the guest result. Returns false (nothing stored) when the marker
 * already exists, so two parallel requests from one browser can't both succeed: guest_id is the marker's primary key.
 */
export function recordGuestAnalysis(db: Db, guestId: string, resultId: string, resultJson: string, createdAt: string, now = new Date()): boolean {
  db.exec("BEGIN IMMEDIATE");
  try {
    // A marker past its retention no longer blocks a new free analysis; remove it so the primary key is free again.
    db.prepare("DELETE FROM guest_free_use WHERE guest_id = ? AND used_at < ?").run(guestId, guestCutoffs(now).freeUse);
    const marker = db.prepare("INSERT OR IGNORE INTO guest_free_use (guest_id, used_at) VALUES (?, ?)").run(guestId, createdAt);
    if (!marker.changes) {
      db.exec("ROLLBACK");
      return false;
    }
    db.prepare("INSERT INTO guest_analyses (id, guest_id, result_json, created_at) VALUES (?, ?, ?, ?)").run(
      resultId,
      guestId,
      resultJson,
      createdAt
    );
    db.exec("COMMIT");
    return true;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

/** This browser's unexpired, unclaimed guest result (JSON), if any. */
export function latestGuestResult(db: Db, guestId: string, now = new Date()): string | null {
  purgeExpiredGuestData(db, now);
  const row = db
    .prepare(
      "SELECT result_json FROM guest_analyses WHERE guest_id = ? AND claimed_by IS NULL AND created_at >= ? ORDER BY created_at DESC LIMIT 1"
    )
    .get(guestId, guestCutoffs(now).analyses) as { result_json: string } | undefined;
  return row?.result_json ?? null;
}

/**
 * Moves this browser's unexpired guest results into the account that just signed in, then deletes them from
 * guest_analyses. The free-use marker stays, so the browser still counts as having used its free analysis.
 */
export function claimGuestAnalyses(db: Db, req: Request, userId: string, now = new Date()) {
  const guestId = readGuestId(req);
  if (!guestId) return;
  purgeExpiredGuestData(db, now);
  const rows = db
    .prepare("SELECT id, result_json, created_at FROM guest_analyses WHERE guest_id = ? AND claimed_by IS NULL AND created_at >= ?")
    .all(guestId, guestCutoffs(now).analyses) as unknown as Array<{ id: string; result_json: string; created_at: string }>;
  if (!rows.length) return;
  const insert = db.prepare(`INSERT OR IGNORE INTO analyses
    (id, user_id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const keepMarker = db.prepare("INSERT OR IGNORE INTO guest_free_use (guest_id, used_at) VALUES (?, ?)");
  const remove = db.prepare("DELETE FROM guest_analyses WHERE id = ? AND guest_id = ?");
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const row of rows) {
      const r = JSON.parse(row.result_json);
      insert.run(r.id, userId, r.resumeName, r.jdTitle, r.overallScore, r.strongSkills.length, r.partialSkills.length, r.missingSkills.length, row.result_json, row.created_at);
      keepMarker.run(guestId, row.created_at);
      remove.run(row.id, guestId);
    }
    db.exec("COMMIT");
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
