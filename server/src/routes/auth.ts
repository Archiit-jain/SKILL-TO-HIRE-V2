import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import type { AppDeps } from "../deps.js";
import { handler, HttpError, parseBody } from "../http.js";
import { NO_PASSWORD, publicUser, requireAuth, type UserRow } from "../middleware/auth.js";
import { rateLimited } from "../middleware/security.js";
import { accountExistsEmail, mailErrorCode } from "../email/mailer.js";
import { config } from "../config.js";
import { emailKey } from "../security/fixed-window.js";
import { claimGuestAnalyses } from "../security/guest.js";
import { getDummyHash, hashPassword, isPasswordHash, verifyPassword } from "../security/password.js";
import {
  clearSessionCookie,
  createSession,
  revokeAllSessions,
  revokeSession,
  SESSION_COOKIE,
  setSessionCookie,
  verifySession,
} from "../security/session.js";
import { consumeVerification, sendVerification } from "../security/verification.js";

export const emailSchema = z.string().trim().toLowerCase().max(254).pipe(z.email("Enter a valid email"));
export const passwordSchema = z
  .string()
  .min(8, "Password must be at least 8 characters")
  .max(128, "Password must be at most 128 characters");
export const nameSchema = z
  .string()
  .trim()
  .min(1, "Name is required")
  .max(80, "Name is too long")
  .regex(/^[^<>\u0000-\u001F]+$/, "Name contains invalid characters");

/** Starts a new server-side session (D-7) and moves this browser's free guest analysis into the account (D-6). */
export function startSession(db: Db, req: Request, res: Response, user: UserRow) {
  setSessionCookie(res, createSession(db, user.id, user.token_version));
  claimGuestAnalyses(db, req, user.id);
}

export async function assertAcceptableEmail(deps: AppDeps, email: string) {
  const check = await deps.checkEmail(email);
  if (!check.ok) throw new HttpError(422, check.message, check.code);
}

export function authRouter(db: Db, deps: AppDeps) {
  const router = Router();
  const byEmail = db.prepare("SELECT * FROM users WHERE email = ?");
  const byId = db.prepare("SELECT * FROM users WHERE id = ?");
  const bySub = db.prepare("SELECT * FROM users WHERE google_sub = ?");
  const bumpTokenVersion = db.prepare("UPDATE users SET token_version = token_version + 1 WHERE id = ?");

  /** Which sign-in methods the frontend should offer. */
  router.get("/providers", (_req, res) => {
    res.json({ googleClientId: deps.googleClientId, emailSignup: deps.mailer.canDeliver });
  });

  router.post(
    "/signup",
    deps.ipLimiters.signup,
    handler(async (req, res) => {
      const body = parseBody(z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }), req.body);
      if (!deps.mailer.canDeliver) {
        throw new HttpError(503, "Email sign-up isn't available yet. Please continue with Google.", "email_unavailable");
      }
      // D-10 (P2): new and existing addresses get the same checks, the same password hashing work and the same response,
      // so sign-up can't be used to find out which emails have accounts. The mailbox owner learns the rest by email:
      // a new account gets its verification link, an unverified one gets its link again (subject to the resend
      // cooldown), and a verified account gets a "you already have an account" notice. The password is never applied
      // to an existing account.
      await assertAcceptableEmail(deps, body.email);
      const hash = await hashPassword(body.password);
      let existing = byEmail.get(body.email) as UserRow | undefined;
      if (!existing) {
        const id = randomUUID();
        const now = new Date().toISOString();
        try {
          db.prepare(
            "INSERT INTO users (id, name, email, password_hash, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
          ).run(id, body.name, body.email, hash, now, now);
          existing = byId.get(id) as unknown as UserRow;
        } catch (err) {
          if (!String((err as Error).message).includes("UNIQUE")) throw err;
          existing = byEmail.get(body.email) as UserRow | undefined; // a parallel sign-up created it first
          if (!existing) throw err;
        }
      }
      try {
        if (existing.email_verified) {
          await deps.mailer.send({ to: existing.email, ...accountExistsEmail(existing.name, config.appOrigin) });
        } else {
          await sendVerification(db, deps.mailer, existing);
        }
      } catch (err) {
        console.error(`[auth] sign-up email failed: ${mailErrorCode(err)}`);
        throw new HttpError(502, "We couldn't send the email. Please try again in a minute.", "email_send_failed");
      }
      // No session yet: an account can't be used until its email is verified.
      res.status(201).json({ verificationRequired: true, email: body.email });
    })
  );

  router.post(
    "/login",
    deps.ipLimiters.login,
    handler(async (req, res) => {
      const body = parseBody(z.object({ email: emailSchema, password: z.string().max(128) }), req.body);
      // D-8: at most 5 failed logins per account per 15 minutes. Keyed by the (HMAC of the) submitted email, so known
      // and unknown addresses are limited identically and the 429 reveals nothing. Each attempt is counted up front
      // (parallel guesses can't slip past the limit) and the count is cleared by a successful login.
      const accountKey = emailKey(body.email);
      const waitSeconds = deps.failedLogins.tryConsume(accountKey);
      if (waitSeconds !== null) throw rateLimited(waitSeconds);
      const user = byEmail.get(body.email) as UserRow | undefined;
      let ok: boolean;
      try {
        // Always run one real scrypt comparison, so response time doesn't reveal whether the email exists or signs in
        // with Google only (no password hash).
        const hasPassword = !!user && isPasswordHash(user.password_hash);
        const matches = await verifyPassword(body.password, hasPassword ? user.password_hash : await getDummyHash());
        ok = hasPassword && matches;
      } catch (err) {
        deps.failedLogins.refund(accountKey); // e.g. 503 server_busy: not a failed login
        throw err;
      }
      if (!user || !ok) throw new HttpError(401, "Invalid email or password", "invalid_credentials");
      deps.failedLogins.reset(accountKey);
      if (!user.email_verified) {
        throw new HttpError(403, "Please verify your email first. Check your inbox for the link.", "email_not_verified");
      }
      startSession(db, req, res, user);
      res.json({ user: publicUser(user) });
    })
  );

  /** Always answers the same way so it can't be used to discover which emails have accounts. */
  router.post(
    "/resend-verification",
    deps.ipLimiters.verification,
    handler(async (req, res) => {
      const body = parseBody(z.object({ email: emailSchema }), req.body);
      const user = byEmail.get(body.email) as UserRow | undefined;
      if (user && !user.email_verified && deps.mailer.canDeliver) {
        try {
          await sendVerification(db, deps.mailer, user);
        } catch (err) {
          console.error(`[auth] resend verification failed: ${mailErrorCode(err)}`);
        }
      }
      res.status(202).json({ message: "If that account is waiting for verification, a new link is on its way." });
    })
  );

  router.post(
    "/verify-email",
    deps.ipLimiters.verification,
    handler((req, res) => {
      const body = parseBody(z.object({ token: z.string().min(20).max(200) }), req.body);
      const userId = consumeVerification(db, body.token);
      if (!userId) {
        throw new HttpError(400, "This verification link is invalid or has expired. Request a new one.", "invalid_token");
      }
      const user = byId.get(userId) as unknown as UserRow;
      startSession(db, req, res, user);
      res.json({ user: publicUser(user) });
    })
  );

  router.post(
    "/google",
    deps.ipLimiters.google,
    handler(async (req, res) => {
      if (!deps.googleClientId) throw new HttpError(503, "Google sign-in is not configured", "google_unavailable");
      const body = parseBody(z.object({ credential: z.string().min(20).max(4096) }), req.body);
      const identity = await deps.verifyGoogle(body.credential);
      if (!identity) throw new HttpError(401, "Google sign-in failed. Please try again.", "google_invalid");
      if (!identity.emailVerified) throw new HttpError(403, "Your Google account email isn't verified.", "google_email_unverified");

      const now = new Date().toISOString();
      let user = bySub.get(identity.sub) as UserRow | undefined;
      if (!user) {
        const existing = byEmail.get(identity.email) as UserRow | undefined;
        if (existing) {
          if (existing.email_verified) {
            db.prepare("UPDATE users SET google_sub = ?, updated_at = ? WHERE id = ?").run(identity.sub, now, existing.id);
          } else {
            // Someone registered this email with a password but never proved they own it. Google has now proven the
            // real owner, so drop that unverified password and revoke its sessions (prevents pre-registration takeover).
            db.prepare(
              "UPDATE users SET google_sub = ?, email_verified = 1, password_hash = ?, token_version = token_version + 1, updated_at = ? WHERE id = ?"
            ).run(identity.sub, NO_PASSWORD, now, existing.id);
            db.prepare("DELETE FROM email_verifications WHERE user_id = ?").run(existing.id);
            revokeAllSessions(db, existing.id); // D-7: the squatter's sessions are deleted, not only version-revoked
          }
          user = byId.get(existing.id) as unknown as UserRow;
        } else {
          const id = randomUUID();
          const name = (identity.name ?? identity.email.split("@")[0]).replace(/[<>\u0000-\u001F]/g, "").trim().slice(0, 80) || "Skill2Hire user";
          db.prepare(
            "INSERT INTO users (id, name, email, password_hash, email_verified, google_sub, created_at, updated_at) VALUES (?, ?, ?, ?, 1, ?, ?, ?)"
          ).run(id, name, identity.email, NO_PASSWORD, identity.sub, now, now);
          user = byId.get(id) as unknown as UserRow;
        }
      }
      startSession(db, req, res, user);
      res.json({ user: publicUser(user) });
    })
  );

  /** Revokes only this device's session (D-7). Always 204, with or without a valid session. */
  router.post("/logout", (req, res) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const claims = typeof token === "string" ? verifySession(token) : null;
    if (claims) revokeSession(db, claims.jti, claims.sub);
    clearSessionCookie(res);
    res.status(204).end();
  });

  /** Revokes every session for this user (all devices). */
  router.post(
    "/logout-all",
    requireAuth(db),
    handler((req, res) => {
      revokeAllSessions(db, req.user!.id);
      bumpTokenVersion.run(req.user!.id);
      clearSessionCookie(res);
      res.status(204).end();
    })
  );

  router.get(
    "/me",
    requireAuth(db),
    handler((req, res) => {
      res.json({ user: publicUser(req.user!) });
    })
  );

  return router;
}
