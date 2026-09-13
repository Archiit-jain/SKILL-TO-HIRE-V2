import { randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { config } from "../config.js";
import type { Db } from "../db.js";

export const GUEST_COOKIE = "s2h_guest";

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

/**
 * Copies this browser's guest analysis into the account that just signed in, so the free result isn't lost.
 * The guest row stays (marked claimed) so the browser still counts as having used its free analysis.
 */
export function claimGuestAnalyses(db: Db, req: Request, userId: string) {
  const guestId = readGuestId(req);
  if (!guestId) return;
  const rows = db
    .prepare("SELECT id, result_json, created_at FROM guest_analyses WHERE guest_id = ? AND claimed_by IS NULL")
    .all(guestId) as unknown as Array<{ id: string; result_json: string; created_at: string }>;
  const insert = db.prepare(`INSERT OR IGNORE INTO analyses
    (id, user_id, resume_name, jd_title, overall_score, strong_count, partial_count, missing_count, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const markClaimed = db.prepare("UPDATE guest_analyses SET claimed_by = ? WHERE id = ?");
  for (const row of rows) {
    const r = JSON.parse(row.result_json);
    insert.run(r.id, userId, r.resumeName, r.jdTitle, r.overallScore, r.strongSkills.length, r.partialSkills.length, r.missingSkills.length, row.result_json, row.created_at);
    markClaimed.run(userId, row.id);
  }
}
