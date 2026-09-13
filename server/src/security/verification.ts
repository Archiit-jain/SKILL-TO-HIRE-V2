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
  const latest = db.prepare("SELECT MAX(created_at) AS t FROM email_verifications WHERE user_id = ?").get(user.id) as { t: number | null };
  if (latest.t && now - latest.t < RESEND_COOLDOWN_SECONDS) return false;

  const token = randomBytes(32).toString("base64url");
  db.prepare("DELETE FROM email_verifications WHERE user_id = ?").run(user.id);
  db.prepare("INSERT INTO email_verifications (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)").run(
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
export function consumeVerification(db: Db, token: string): string | null {
  const row = db.prepare("SELECT user_id, expires_at FROM email_verifications WHERE token_hash = ?").get(hashToken(token)) as
    | { user_id: string; expires_at: number }
    | undefined;
  if (!row) return null;
  db.prepare("DELETE FROM email_verifications WHERE user_id = ?").run(row.user_id);
  if (row.expires_at < Math.floor(Date.now() / 1000)) return null;
  db.prepare("UPDATE users SET email_verified = 1, updated_at = ? WHERE id = ?").run(new Date().toISOString(), row.user_id);
  return row.user_id;
}
