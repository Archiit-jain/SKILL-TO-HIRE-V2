import { randomUUID } from "node:crypto";
import { Router, type Request, type Response } from "express";
import { z } from "zod";
import type { Db } from "../db.js";
import type { AppDeps } from "../deps.js";
import { handler, HttpError, parseBody } from "../http.js";
import { NO_PASSWORD, publicUser, requireAuth, type UserRow } from "../middleware/auth.js";
import { authLimiter } from "../middleware/security.js";
import { claimGuestAnalyses } from "../security/guest.js";
import { getDummyHash, hashPassword, verifyPassword } from "../security/password.js";
import { clearSessionCookie, setSessionCookie, signSession } from "../security/session.js";
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

/** Starts a session and moves this browser's free guest analysis into the account. */
export function startSession(db: Db, req: Request, res: Response, user: UserRow) {
  setSessionCookie(res, signSession(user.id, user.token_version));
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
    authLimiter,
    handler(async (req, res) => {
      const body = parseBody(z.object({ name: nameSchema, email: emailSchema, password: passwordSchema }), req.body);
      if (!deps.mailer.canDeliver) {
        throw new HttpError(503, "Email sign-up isn't available yet. Please continue with Google.", "email_unavailable");
      }
      const existing = byEmail.get(body.email) as UserRow | undefined;
      if (existing) {
        throw new HttpError(
          409,
          existing.email_verified
            ? "An account with this email already exists. Log in instead."
            : "This email is registered but not verified yet. Check your inbox or resend the verification email.",
          existing.email_verified ? "email_taken" : "email_unverified_exists"
        );
      }
      await assertAcceptableEmail(deps, body.email);

      const id = randomUUID();
      const now = new Date().toISOString();
      const hash = await hashPassword(body.password);
      try {
        db.prepare(
          "INSERT INTO users (id, name, email, password_hash, email_verified, created_at, updated_at) VALUES (?, ?, ?, ?, 0, ?, ?)"
        ).run(id, body.name, body.email, hash, now, now);
      } catch (err) {
        if (String((err as Error).message).includes("UNIQUE")) {
          throw new HttpError(409, "An account with this email already exists", "email_taken");
        }
        throw err;
      }
      try {
        await sendVerification(db, deps.mailer, { id, name: body.name, email: body.email });
      } catch (err) {
        console.error("[auth] verification email failed:", (err as Error).message);
        throw new HttpError(502, "Account created, but we couldn't send the verification email. Try \"Resend\" in a minute.", "email_send_failed");
      }
      // No session yet: the account can't be used until the email is verified.
      res.status(201).json({ verificationRequired: true, email: body.email });
    })
  );

  router.post(
    "/login",
    authLimiter,
    handler(async (req, res) => {
      const body = parseBody(z.object({ email: emailSchema, password: z.string().max(128) }), req.body);
      const user = byEmail.get(body.email) as UserRow | undefined;
      // Always run a hash comparison so response time doesn't reveal whether the email exists.
      const ok = await verifyPassword(body.password, user?.password_hash ?? (await getDummyHash()));
      if (!user || !ok) throw new HttpError(401, "Invalid email or password", "invalid_credentials");
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
    authLimiter,
    handler(async (req, res) => {
      const body = parseBody(z.object({ email: emailSchema }), req.body);
      const user = byEmail.get(body.email) as UserRow | undefined;
      if (user && !user.email_verified && deps.mailer.canDeliver) {
        try {
          await sendVerification(db, deps.mailer, user);
        } catch (err) {
          console.error("[auth] resend verification failed:", (err as Error).message);
        }
      }
      res.status(202).json({ message: "If that account is waiting for verification, a new link is on its way." });
    })
  );

  router.post(
    "/verify-email",
    authLimiter,
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
    authLimiter,
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

  router.post("/logout", (_req, res) => {
    clearSessionCookie(res);
    res.status(204).end();
  });

  /** Revokes every session for this user (all devices). */
  router.post(
    "/logout-all",
    requireAuth(db),
    handler((req, res) => {
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
