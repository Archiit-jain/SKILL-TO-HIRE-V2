import { randomUUID } from "node:crypto";
import type { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";
import type { Db } from "../db.js";

export const SESSION_COOKIE = "s2h_session";

interface SessionClaims {
  sub: string;
  tv: number;
  /** Session id: the `sessions` row that must exist for the token to be accepted (security remediation P1, D-7). */
  jti: string;
}

export function signSession(userId: string, tokenVersion: number, sessionId: string): string {
  return jwt.sign({ tv: tokenVersion } satisfies Pick<SessionClaims, "tv">, config.jwtSecret, {
    algorithm: "HS256",
    subject: userId,
    jwtid: sessionId,
    expiresIn: config.sessionTtlSeconds,
    issuer: "skill2hire",
    audience: "skill2hire-web",
  });
}

/** Checks signature, algorithm, expiry, issuer and audience. Tokens without a jti (issued before D-7) are rejected. */
export function verifySession(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      issuer: "skill2hire",
      audience: "skill2hire-web",
    });
    if (
      typeof payload !== "object" ||
      typeof payload.sub !== "string" ||
      typeof payload.tv !== "number" ||
      typeof payload.jti !== "string" ||
      !payload.jti
    ) {
      return null;
    }
    return { sub: payload.sub, tv: payload.tv, jti: payload.jti };
  } catch {
    return null;
  }
}

// ---- Server-side session rows (D-7) ---------------------------------------------------------------------------------

/** Creates a session row (removing expired rows first) and returns the signed token for it. */
export function createSession(db: Db, userId: string, tokenVersion: number, now = new Date()): string {
  const id = randomUUID();
  const expires = new Date(now.getTime() + config.sessionTtlSeconds * 1000);
  db.prepare("DELETE FROM sessions WHERE expires_at <= ?").run(now.toISOString());
  db.prepare("INSERT INTO sessions (id, user_id, created_at, expires_at) VALUES (?, ?, ?, ?)").run(
    id,
    userId,
    now.toISOString(),
    expires.toISOString()
  );
  return signSession(userId, tokenVersion, id);
}

/** True when the session exists, belongs to `userId` and hasn't expired. */
export function isSessionActive(db: Db, sessionId: string, userId: string, now = new Date()): boolean {
  return !!db
    .prepare("SELECT 1 FROM sessions WHERE id = ? AND user_id = ? AND expires_at > ?")
    .get(sessionId, userId, now.toISOString());
}

/** Revokes one session. Scoped to the owner so one user's token can't revoke another user's session. */
export function revokeSession(db: Db, sessionId: string, userId: string) {
  db.prepare("DELETE FROM sessions WHERE id = ? AND user_id = ?").run(sessionId, userId);
}

/** Revokes every session of a user (all devices). */
export function revokeAllSessions(db: Db, userId: string) {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

function cookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProd,
    sameSite: "strict",
    path: "/api",
  };
}

export function setSessionCookie(res: Response, token: string) {
  res.cookie(SESSION_COOKIE, token, { ...cookieOptions(), maxAge: config.sessionTtlSeconds * 1000 });
}

export function clearSessionCookie(res: Response) {
  res.clearCookie(SESSION_COOKIE, cookieOptions());
}
