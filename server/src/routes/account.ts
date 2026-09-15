import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import type { AppDeps } from "../deps.js";
import { handler, HttpError, parseBody } from "../http.js";
import { NO_PASSWORD, publicUser, requireAuth, type UserRow } from "../middleware/auth.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { clearSessionCookie, createSession, revokeAllSessions, setSessionCookie } from "../security/session.js";
import { mailErrorCode } from "../email/mailer.js";
import { sendVerification } from "../security/verification.js";
import { assertAcceptableEmail, emailSchema, nameSchema, passwordSchema } from "./auth.js";

export function accountRouter(db: Db, deps: AppDeps) {
  const router = Router();
  router.use(requireAuth(db));

  const hasPassword = (u: UserRow) => u.password_hash !== NO_PASSWORD;

  async function assertPassword(user: UserRow, password: string | undefined) {
    if (!password || !(await verifyPassword(password, user.password_hash))) {
      throw new HttpError(403, "Current password is incorrect", "invalid_password");
    }
  }

  router.get("/settings", (req, res) => {
    const u = req.user!;
    res.json({ privacyMode: !!u.privacy_mode, notifications: !!u.notifications });
  });

  router.put(
    "/settings",
    handler(async (req, res) => {
      const body = parseBody(z.object({ privacyMode: z.boolean(), notifications: z.boolean() }).strict(), req.body);
      await db.run(
        "UPDATE users SET privacy_mode = ?, notifications = ?, updated_at = ? WHERE id = ?",
        body.privacyMode ? 1 : 0,
        body.notifications ? 1 : 0,
        new Date().toISOString(),
        req.user!.id
      );
      res.json(body);
    })
  );

  /**
   * Update name and/or email. A new email needs the current password (if the account has one), must pass the
   * fake-email checks, and must be verified again before the next login.
   */
  router.patch(
    "/",
    deps.ipLimiters.account,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({ name: nameSchema, email: emailSchema, currentPassword: z.string().max(128).optional() }).strict(),
        req.body
      );
      const user = req.user!;
      const emailChanged = body.email !== user.email.toLowerCase();
      if (emailChanged) {
        if (!hasPassword(user)) {
          throw new HttpError(400, "This account signs in with Google. Set a password first to change the email.", "password_required");
        }
        await assertPassword(user, body.currentPassword);
        if (!deps.mailer.canDeliver) throw new HttpError(503, "Email changes aren't available yet.", "email_unavailable");
        const other = await db.get<{ id: string }>("SELECT id FROM users WHERE email = ?", body.email);
        if (other && other.id !== user.id) throw new HttpError(409, "An account with this email already exists", "email_taken");
        await assertAcceptableEmail(deps, body.email);
      }
      const now = new Date().toISOString();
      if (emailChanged) {
        // The Google link belonged to the old address, so it is removed along with the verified flag.
        try {
          await db.run(
            "UPDATE users SET name = ?, email = ?, email_verified = 0, google_sub = NULL, updated_at = ? WHERE id = ?",
            body.name,
            body.email,
            now,
            user.id
          );
        } catch (err) {
          // A parallel sign-up took the address between the check above and this update.
          if (String((err as Error).message).includes("UNIQUE")) throw new HttpError(409, "An account with this email already exists", "email_taken");
          throw err;
        }
        // D-7: other devices are signed out; this device gets a fresh session.
        await revokeAllSessions(db, user.id);
        setSessionCookie(res, await createSession(db, user.id, user.token_version));
        await sendVerification(db, deps.mailer, { id: user.id, name: body.name, email: body.email }).catch((err) =>
          console.error(`[account] verification email failed: ${mailErrorCode(err)}`)
        );
      } else {
        await db.run("UPDATE users SET name = ?, updated_at = ? WHERE id = ?", body.name, now, user.id);
      }
      const updated = (await db.get<UserRow>("SELECT * FROM users WHERE id = ?", user.id))!;
      res.json({ user: publicUser(updated), verificationSent: emailChanged });
    })
  );

  /**
   * Change password (verifies the current one) or, for Google-only accounts, set a first password.
   * Revokes all other sessions.
   */
  router.put(
    "/password",
    deps.ipLimiters.account,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({ currentPassword: z.string().max(128).optional(), newPassword: passwordSchema }).strict(),
        req.body
      );
      const user = req.user!;
      if (hasPassword(user)) {
        await assertPassword(user, body.currentPassword);
        if (body.currentPassword === body.newPassword) throw new HttpError(400, "New password must be different", "validation");
      }
      const hash = await hashPassword(body.newPassword);
      await db.run(
        "UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?",
        hash,
        new Date().toISOString(),
        user.id
      );
      // D-7: every session is revoked (rows deleted and token version bumped); this device gets a new session.
      await revokeAllSessions(db, user.id);
      setSessionCookie(res, await createSession(db, user.id, user.token_version + 1));
      res.status(204).end();
    })
  );

  /** Permanently delete the account and everything stored for it. */
  router.delete(
    "/",
    deps.ipLimiters.account,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({ currentPassword: z.string().max(128).optional(), confirm: z.string().max(20).optional() }).strict(),
        req.body
      );
      const user = req.user!;
      if (hasPassword(user)) {
        await assertPassword(user, body.currentPassword);
      } else if (body.confirm !== "DELETE") {
        throw new HttpError(400, 'Type DELETE to confirm account deletion', "confirmation_required");
      }
      // Child rows are deleted explicitly, in one transaction, rather than relying on ON DELETE CASCADE: foreign key
      // enforcement is a per-connection setting that a hosted database connection may not have enabled.
      await db.transaction(async (tx) => {
        await tx.run("DELETE FROM analyses WHERE user_id = ?", user.id);
        await tx.run("DELETE FROM sessions WHERE user_id = ?", user.id);
        await tx.run("DELETE FROM email_verifications WHERE user_id = ?", user.id);
        await tx.run("DELETE FROM assistant_usage WHERE user_id = ?", user.id);
        await tx.run("DELETE FROM users WHERE id = ?", user.id);
      });
      clearSessionCookie(res);
      res.status(204).end();
    })
  );

  return router;
}
