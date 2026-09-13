import type { CookieOptions, Response } from "express";
import jwt from "jsonwebtoken";
import { config } from "../config.js";

export const SESSION_COOKIE = "s2h_session";

interface SessionClaims {
  sub: string;
  tv: number;
}

export function signSession(userId: string, tokenVersion: number): string {
  return jwt.sign({ tv: tokenVersion } satisfies Omit<SessionClaims, "sub">, config.jwtSecret, {
    algorithm: "HS256",
    subject: userId,
    expiresIn: config.sessionTtlSeconds,
    issuer: "skill2hire",
    audience: "skill2hire-web",
  });
}

export function verifySession(token: string): SessionClaims | null {
  try {
    const payload = jwt.verify(token, config.jwtSecret, {
      algorithms: ["HS256"],
      issuer: "skill2hire",
      audience: "skill2hire-web",
    });
    if (typeof payload !== "object" || typeof payload.sub !== "string" || typeof payload.tv !== "number") {
      return null;
    }
    return { sub: payload.sub, tv: payload.tv };
  } catch {
    return null;
  }
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
