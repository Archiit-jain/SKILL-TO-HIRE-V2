import type { NextFunction, Request, Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { config } from "../config.js";
import { HttpError } from "../http.js";

// Google Identity Services (the "Sign in with Google" button) loads a script, a stylesheet and an iframe from
// accounts.google.com and opens a popup, which needs COOP same-origin-allow-popups.
const GIS = "https://accounts.google.com/gsi/";

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", `${GIS}client`],
      // Radix ScrollArea injects a small <style> element; everything else is a same-origin stylesheet.
      "style-src": ["'self'", "'unsafe-inline'", `${GIS}style`],
      "img-src": ["'self'", "data:", "https://lh3.googleusercontent.com"],
      "connect-src": ["'self'", GIS],
      "frame-src": [GIS],
      "object-src": ["'none'"],
      "frame-ancestors": ["'none'"],
      "base-uri": ["'self'"],
      "form-action": ["'self'"],
      "upgrade-insecure-requests": config.isProd ? [] : null,
    },
  },
  crossOriginEmbedderPolicy: false,
  crossOriginOpenerPolicy: { policy: "same-origin-allow-popups" },
  hsts: config.isProd,
  referrerPolicy: { policy: "strict-origin-when-cross-origin" },
});

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);
export const CSRF_HEADER = "x-requested-with";
export const CSRF_HEADER_VALUE = "skill2hire";

/**
 * CSRF defence in depth on top of SameSite=Strict cookies:
 *  1. state-changing requests must carry a custom header (forces a CORS preflight, which this API never allows), and
 *  2. if the browser sends Origin, it must be our own origin.
 */
export function csrfProtection(req: Request, _res: Response, next: NextFunction) {
  if (SAFE_METHODS.has(req.method)) return next();
  if (req.get(CSRF_HEADER) !== CSRF_HEADER_VALUE) {
    return next(new HttpError(403, "Missing CSRF header", "csrf"));
  }
  const origin = req.get("origin");
  if (origin) {
    const host = req.get("host");
    const allowed = new Set([config.appOrigin, `${req.protocol}://${host}`]);
    if (!allowed.has(origin)) return next(new HttpError(403, "Cross-origin request rejected", "csrf"));
  }
  next();
}

const limiterDefaults = {
  standardHeaders: "draft-8" as const,
  legacyHeaders: false,
  skip: () => config.isTest,
  handler: (_req: Request, _res: Response, next: NextFunction) =>
    next(new HttpError(429, "Too many requests, please try again later", "rate_limited")),
};

export const apiLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: 300 });
export const authLimiter = rateLimit({ ...limiterDefaults, windowMs: 15 * 60_000, limit: 10 });
export const analysisLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 60_000, limit: 30 });
export const assistantLimiter = rateLimit({ ...limiterDefaults, windowMs: 60 * 60_000, limit: 60 });
