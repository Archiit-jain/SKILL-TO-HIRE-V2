import type { NextFunction, Request, RequestHandler, Response } from "express";
import { rateLimit } from "express-rate-limit";
import helmet from "helmet";
import { config } from "../config.js";
import { HttpError } from "../http.js";

// Google Identity Services (the "Sign in with Google" button) loads a script, a stylesheet and an iframe from
// accounts.google.com and opens a popup, which needs COOP same-origin-allow-popups.
const GIS = "https://accounts.google.com/gsi/";

/** The only inline <style> the app creates: Radix ScrollArea's viewport style (P2: allowed by hash, no 'unsafe-inline'). */
export const RADIX_SCROLL_AREA_STYLE =
  "[data-radix-scroll-area-viewport]{scrollbar-width:none;-ms-overflow-style:none;-webkit-overflow-scrolling:touch;}[data-radix-scroll-area-viewport]::-webkit-scrollbar{display:none}";
export const RADIX_SCROLL_AREA_STYLE_HASH = "'sha256-vGQdhYJbTuF+M8iCn1IZCHpdkiICocWHDq4qnQF4Rjw='";

export const securityHeaders = helmet({
  contentSecurityPolicy: {
    useDefaults: true,
    directives: {
      "default-src": ["'self'"],
      "script-src": ["'self'", `${GIS}client`],
      // Radix ScrollArea injects one fixed <style> element, allowed by its hash; everything else is a same-origin
      // stylesheet. React sets style properties through the DOM (CSSOM), which CSP doesn't restrict.
      "style-src": ["'self'", RADIX_SCROLL_AREA_STYLE_HASH, `${GIS}style`],
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

export const RATE_LIMITED_MESSAGE = "Too many requests, please try again later";

/** The same 429 body every limiter uses; `retryAfterSeconds` adds a Retry-After header (per-account/per-user limits). */
export const rateLimited = (retryAfterSeconds?: number) =>
  new HttpError(429, RATE_LIMITED_MESSAGE, "rate_limited", retryAfterSeconds ? { "Retry-After": String(retryAfterSeconds) } : undefined);

/** Per-IP limits (D-14 values kept; the auth limiter split into per-route limiters by owner decision D-8, P2). */
export const IP_LIMITS = {
  api: { windowMs: 15 * 60_000, limit: 300 },
  login: { windowMs: 15 * 60_000, limit: 20 },
  signup: { windowMs: 60 * 60_000, limit: 5 },
  /** Shared by POST /auth/verify-email and POST /auth/resend-verification. */
  verification: { windowMs: 15 * 60_000, limit: 10 },
  google: { windowMs: 15 * 60_000, limit: 20 },
  /** Profile, password and account deletion (the former shared auth limit, unchanged). */
  account: { windowMs: 15 * 60_000, limit: 10 },
  analysis: { windowMs: 60 * 60_000, limit: 30 },
  assistant: { windowMs: 60 * 60_000, limit: 60 },
} as const;

export type IpLimiters = { [K in keyof typeof IP_LIMITS]: RequestHandler };

/**
 * One fresh set of in-memory per-IP limiters per app. `enabled: false` (the default under NODE_ENV=test) turns them into
 * no-ops so unrelated tests aren't throttled; the rate-limit tests create apps with `enabled: true`. Keys are the
 * client IP as Express sees it (`trust proxy` only when TRUST_PROXY=true), so a spoofed X-Forwarded-For is ignored
 * unless the app runs behind a trusted proxy.
 */
export function createIpLimiters({ enabled = !config.isTest }: { enabled?: boolean } = {}): IpLimiters {
  const make = ({ windowMs, limit }: { windowMs: number; limit: number }) =>
    rateLimit({
      windowMs,
      limit,
      standardHeaders: "draft-8",
      legacyHeaders: false,
      skip: () => !enabled,
      handler: (_req: Request, _res: Response, next: NextFunction) => next(rateLimited()),
    });
  return Object.fromEntries(Object.entries(IP_LIMITS).map(([name, spec]) => [name, make(spec)])) as unknown as IpLimiters;
}
