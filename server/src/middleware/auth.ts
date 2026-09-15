import type { NextFunction, Request, Response } from "express";
import type { Db } from "../db.js";
import { HttpError } from "../http.js";
import { clearSessionCookie, isSessionActive, SESSION_COOKIE, verifySession } from "../security/session.js";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  /** "!" marks an account without a password (created through Google sign-in). */
  password_hash: string;
  token_version: number;
  privacy_mode: number;
  notifications: number;
  email_verified: number;
  google_sub: string | null;
  created_at: string;
  updated_at: string;
}

export const NO_PASSWORD = "!";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
      /** The jti of the session that authenticated this request (D-7). */
      sessionId?: string;
    }
  }
}

/**
 * A request is authenticated only when (D-7): the JWT is valid (signature, algorithm, expiry, issuer, audience, jti
 * present), the user exists, the token version matches, and a non-expired session row with that jti belongs to the
 * same user. Logout deletes the row, so a copied token stops working immediately.
 */
function sessionUser(db: Db, req: Request, res: Response): { user: UserRow; sessionId: string } | null {
  const token = req.cookies?.[SESSION_COOKIE];
  if (typeof token !== "string") return null;
  const claims = verifySession(token);
  const user = claims ? (db.prepare("SELECT * FROM users WHERE id = ?").get(claims.sub) as UserRow | undefined) : undefined;
  // token_version mismatch = logged out everywhere / password changed / account deleted.
  if (!claims || !user || user.token_version !== claims.tv || !isSessionActive(db, claims.jti, user.id)) {
    clearSessionCookie(res);
    return null;
  }
  return { user, sessionId: claims.jti };
}

export function requireAuth(db: Db) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = sessionUser(db, req, res);
    if (!session) return next(new HttpError(401, "Not authenticated", "unauthenticated"));
    req.user = session.user;
    req.sessionId = session.sessionId;
    next();
  };
}

/** Attaches req.user when a valid session exists, but lets guests through. */
export function optionalAuth(db: Db) {
  return (req: Request, res: Response, next: NextFunction) => {
    const session = sessionUser(db, req, res);
    req.user = session?.user;
    req.sessionId = session?.sessionId;
    next();
  };
}

export function publicUser(u: UserRow) {
  return {
    name: u.name,
    email: u.email,
    hasPassword: u.password_hash !== NO_PASSWORD,
    googleLinked: !!u.google_sub,
    emailVerified: !!u.email_verified,
  };
}
