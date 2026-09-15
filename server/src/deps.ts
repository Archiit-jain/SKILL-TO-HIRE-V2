import { defaultDocumentParser, type DocumentParser } from "./analysis/document-parser.js";
import { ParseSlots } from "./analysis/parse-slots.js";
import { createGeminiPhraser, type GeminiPhraser } from "./assistant/gemini.js";
import type { GeminiQuotaLimits } from "./assistant/quota.js";
import { config } from "./config.js";
import { FixedWindowCounter } from "./security/fixed-window.js";
import { createIpLimiters, type IpLimiters } from "./middleware/security.js";
import { createMailer, type Mailer } from "./email/mailer.js";
import { defaultEmailChecker, type EmailChecker } from "./security/email-check.js";
import { defaultGoogleVerifier, type GoogleVerifier } from "./security/google.js";

/** External services the app talks to. Tests replace them with fakes. */
export interface AppDeps {
  mailer: Mailer;
  checkEmail: EmailChecker;
  verifyGoogle: GoogleVerifier;
  /** OAuth client ID for Google sign-in; null disables it. */
  googleClientId: string | null;
  /** Concurrent document parses allowed on this instance (D-5). */
  parseSlots: ParseSlots;
  /** D-11: document extraction in terminable parse workers, with a deadline. */
  documentParser: DocumentParser;
  /** D-11: parse deadline per upload request, in ms. */
  parseTimeoutMs: number;
  /** Per-IP rate limiters (P2 split of the auth limiter; disabled by default in tests). */
  ipLimiters: IpLimiters;
  /** L-4: include assistant/storage details in GET /api/health (development and tests only). */
  healthDetails: boolean;
  /** D-8: failed logins per account (keyed by an HMAC of the email). */
  failedLogins: FixedWindowCounter;
  /** D-8: assistant requests per user. */
  assistantRequests: FixedWindowCounter;
  /** D-9: Gemini phrasing; null = rules-only assistant. Tests inject a fake, never the real client. */
  gemini: GeminiPhraser | null;
  geminiQuota: GeminiQuotaLimits;
  /** Clock for quota days (UTC). */
  now: () => Date;
}

export function defaultDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    mailer: overrides.mailer ?? createMailer(),
    checkEmail: overrides.checkEmail ?? defaultEmailChecker,
    verifyGoogle: overrides.verifyGoogle ?? defaultGoogleVerifier,
    googleClientId: overrides.googleClientId !== undefined ? overrides.googleClientId : config.googleClientId,
    parseSlots: overrides.parseSlots ?? new ParseSlots(),
    documentParser: overrides.documentParser ?? defaultDocumentParser,
    parseTimeoutMs: overrides.parseTimeoutMs ?? config.upload.parseTimeoutMs,
    ipLimiters: overrides.ipLimiters ?? createIpLimiters(),
    healthDetails: overrides.healthDetails ?? !config.isProd,
    failedLogins: overrides.failedLogins ?? new FixedWindowCounter(config.security.failedLoginsPerAccount, config.security.failedLoginWindowMs),
    assistantRequests:
      overrides.assistantRequests ?? new FixedWindowCounter(config.security.assistantRequestsPerUser, config.security.assistantWindowMs),
    gemini: overrides.gemini !== undefined ? overrides.gemini : config.gemini && !config.isTest ? createGeminiPhraser(config.gemini) : null,
    geminiQuota: overrides.geminiQuota ?? {
      perUserPerDay: config.security.geminiAnswersPerUserPerDay,
      globalPerDay: config.security.geminiAnswersGlobalPerDay,
    },
    now: overrides.now ?? (() => new Date()),
  };
}
