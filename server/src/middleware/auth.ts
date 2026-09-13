import type { NextFunction, Request, Response } from "express";
import type { Db } from "../db.js";
import { HttpError } from "../http.js";
import { clearSessionCookie, SESSION_COOKIE, verifySession } from "../security/session.js";

export interface UserRow {
  id: string;
  name: string;
  email: string;
  password_hash: string;
  token_version: number;
  privacy_mode: number;
  notifications: number;
  created_at: string;
  updated_at: string;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRow;
    }
  }
}

export function requireAuth(db: Db) {
  const findUser = db.prepare("SELECT * FROM users WHERE id = ?");
  return (req: Request, res: Response, next: NextFunction) => {
    const token = req.cookies?.[SESSION_COOKIE];
    const claims = typeof token === "string" ? verifySession(token) : null;
    const user = claims ? (findUser.get(claims.sub) as UserRow | undefined) : undefined;
    // token_version mismatch = logged out everywhere / password changed / account deleted.
    if (!claims || !user || user.token_version !== claims.tv) {
      if (token) clearSessionCookie(res);
      return next(new HttpError(401, "Not authenticated", "unauthenticated"));
    }
    req.user = user;
    next();
  };
}

export function publicUser(u: UserRow) {
  return { name: u.name, email: u.email };
}
