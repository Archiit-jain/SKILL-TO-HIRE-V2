import { Router } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import { handler, HttpError, parseBody } from "../http.js";
import { publicUser, requireAuth, type UserRow } from "../middleware/auth.js";
import { authLimiter } from "../middleware/security.js";
import { hashPassword, verifyPassword } from "../security/password.js";
import { clearSessionCookie, setSessionCookie, signSession } from "../security/session.js";
import { emailSchema, nameSchema, passwordSchema } from "./auth.js";

export function accountRouter(db: Db) {
  const router = Router();
  router.use(requireAuth(db));

  const getUser = db.prepare("SELECT * FROM users WHERE id = ?");
  const byEmail = db.prepare("SELECT id FROM users WHERE email = ?");

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
    handler((req, res) => {
      const body = parseBody(z.object({ privacyMode: z.boolean(), notifications: z.boolean() }).strict(), req.body);
      db.prepare("UPDATE users SET privacy_mode = ?, notifications = ?, updated_at = ? WHERE id = ?").run(
        body.privacyMode ? 1 : 0,
        body.notifications ? 1 : 0,
        new Date().toISOString(),
        req.user!.id
      );
      res.json(body);
    })
  );

  /** Update name and/or email. Changing the email requires the current password. */
  router.patch(
    "/",
    authLimiter,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({ name: nameSchema, email: emailSchema, currentPassword: z.string().max(128).optional() }).strict(),
        req.body
      );
      const user = req.user!;
      if (body.email !== user.email.toLowerCase()) {
        await assertPassword(user, body.currentPassword);
        const other = byEmail.get(body.email) as { id: string } | undefined;
        if (other && other.id !== user.id) throw new HttpError(409, "An account with this email already exists", "email_taken");
      }
      db.prepare("UPDATE users SET name = ?, email = ?, updated_at = ? WHERE id = ?").run(
        body.name,
        body.email,
        new Date().toISOString(),
        user.id
      );
      res.json({ user: publicUser(getUser.get(user.id) as unknown as UserRow) });
    })
  );

  /** Change password: verifies the current one, then revokes all other sessions. */
  router.put(
    "/password",
    authLimiter,
    handler(async (req, res) => {
      const body = parseBody(
        z.object({ currentPassword: z.string().max(128), newPassword: passwordSchema }).strict(),
        req.body
      );
      const user = req.user!;
      await assertPassword(user, body.currentPassword);
      if (body.currentPassword === body.newPassword) throw new HttpError(400, "New password must be different", "validation");
      const hash = await hashPassword(body.newPassword);
      db.prepare(
        "UPDATE users SET password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?"
      ).run(hash, new Date().toISOString(), user.id);
      setSessionCookie(res, signSession(user.id, user.token_version + 1));
      res.status(204).end();
    })
  );

  /** Permanently delete the account and (via ON DELETE CASCADE) every stored analysis. */
  router.delete(
    "/",
    authLimiter,
    handler(async (req, res) => {
      const body = parseBody(z.object({ currentPassword: z.string().max(128) }).strict(), req.body);
      await assertPassword(req.user!, body.currentPassword);
      db.prepare("DELETE FROM users WHERE id = ?").run(req.user!.id);
      clearSessionCookie(res);
      res.status(204).end();
    })
  );

  return router;
}
