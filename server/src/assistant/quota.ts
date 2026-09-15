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
 * one write transaction, so concurrent requests (in one instance, or across instances on the hosted database) can never
 * exceed either limit. Counters from earlier UTC days are deleted on the way (they are only needed for today's limits).
 */
export async function reserveGeminiAnswer(db: Db, userId: string, limits: GeminiQuotaLimits, now: Date): Promise<QuotaDecision> {
  const day = utcDay(now);
  return db.transaction(async (tx) => {
    await tx.run("DELETE FROM assistant_usage WHERE day < ?", day);
    await tx.run("DELETE FROM assistant_usage_global WHERE day < ?", day);
    const global = Number((await tx.get<{ count: number }>("SELECT count FROM assistant_usage_global WHERE day = ?", day))?.count ?? 0);
    const user = Number((await tx.get<{ count: number }>("SELECT count FROM assistant_usage WHERE user_id = ? AND day = ?", userId, day))?.count ?? 0);
    const decision: QuotaDecision =
      user >= limits.perUserPerDay
        ? { admitted: false, reason: "quota_user" }
        : global >= limits.globalPerDay
          ? { admitted: false, reason: "quota_global" }
          : { admitted: true };
    if (decision.admitted) {
      await tx.run("INSERT INTO assistant_usage_global (day, count) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET count = count + 1", day);
      await tx.run(
        "INSERT INTO assistant_usage (user_id, day, count) VALUES (?, ?, 1) ON CONFLICT(user_id, day) DO UPDATE SET count = count + 1",
        userId,
        day
      );
    }
    return decision;
  });
}
