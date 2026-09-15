import type { Db } from "../db.js";

export interface GeminiQuotaLimits {
  perUserPerDay: number;
  globalPerDay: number;
}

export type QuotaDecision = { admitted: true } | { admitted: false; reason: "quota_user" | "quota_global" };

/** UTC calendar day "YYYY-MM-DD" (D-9 / E-5: quotas reset at UTC midnight). */
export const utcDay = (now: Date) => now.toISOString().slice(0, 10);

/**
 * Reserves one Gemini answer for this user today, before Gemini is called (E-4). The check and both increments run in
 * one synchronous IMMEDIATE transaction with no await in between, so concurrent requests can never exceed either limit.
 * Counters from earlier UTC days are deleted on the way (they are only needed for today's limits).
 */
export function reserveGeminiAnswer(db: Db, userId: string, limits: GeminiQuotaLimits, now: Date): QuotaDecision {
  const day = utcDay(now);
  db.exec("BEGIN IMMEDIATE");
  try {
    db.prepare("DELETE FROM assistant_usage WHERE day < ?").run(day);
    db.prepare("DELETE FROM assistant_usage_global WHERE day < ?").run(day);
    const global = (db.prepare("SELECT count FROM assistant_usage_global WHERE day = ?").get(day) as { count: number } | undefined)?.count ?? 0;
    const user =
      (db.prepare("SELECT count FROM assistant_usage WHERE user_id = ? AND day = ?").get(userId, day) as { count: number } | undefined)?.count ?? 0;
    const decision: QuotaDecision =
      user >= limits.perUserPerDay
        ? { admitted: false, reason: "quota_user" }
        : global >= limits.globalPerDay
          ? { admitted: false, reason: "quota_global" }
          : { admitted: true };
    if (decision.admitted) {
      db.prepare("INSERT INTO assistant_usage_global (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1").run(day);
      db.prepare("INSERT INTO assistant_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1").run(
        userId,
        day
      );
    }
    db.exec("COMMIT");
    return decision;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}
