import { createHash, randomBytes } from "node:crypto";
import { config } from "../config.js";
import type { Db } from "../db.js";
import { verificationEmail, type Mailer } from "../email/mailer.js";
import type { UserRow } from "../middleware/auth.js";

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

/** Minimum gap between verification emails for one account, to stop the resend button being used to spam an inbox. */
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Creates a single-use verification token (only its SHA-256 hash is stored), replaces any older ones, and emails the
 * link. Returns false if the cooldown hasn't passed.
 */
export async function sendVerification(db: Db, mailer: Mailer, user: Pick<UserRow, "id" | "name" | "email">): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000);
  const latest = await db.get<{ t: number | null }>("SELECT MAX(created_at) AS t FROM email_verifications WHERE user_id = ?", user.id);
  if (latest?.t && now - latest.t < RESEND_COOLDOWN_SECONDS) return false;

  const token = randomBytes(32).toString("base64url");
  await db.run("DELETE FROM email_verifications WHERE user_id = ?", user.id);
  await db.run(
    "INSERT INTO email_verifications (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)",
    hashToken(token),
    user.id,
    now + config.emailVerificationTtlSeconds,
    now
  );
  const link = `${config.appOrigin}/?verify=${encodeURIComponent(token)}`;
  await mailer.send({ to: user.email, ...verificationEmail(user.name, link, config.emailVerificationTtlSeconds / 3600) });
  return true;
}

/** Consumes a token. Returns the verified user id, or null if the token is unknown or expired. */
export async function consumeVerification(db: Db, token: string): Promise<string | null> {
  // One transaction, so a token is consumed at most once even by parallel requests on different instances.
  return db.transaction(async (tx) => {
    const row = await tx.get<{ user_id: string; expires_at: number }>(
      "SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?",
      hashToken(token)
    );
    if (!row) return null;
    await tx.run("DELETE FROM email_verifications WHERE user_id = ?", row.user_id);
    if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
    await tx.run("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?", new Date().toISOString(), row.user_id);
    return row.user_id;
  });
}
