import { ParseSlots } from "./analysis/parse-slots.js";
import { createGeminiPhraser, type GeminiPhraser } from "./assistant/gemini.js";
import type { GeminiQuotaLimits } from "./assistant/quota.js";
import { config } from "./config.js";
import { FixedWindowCounter } from "./security/fixed-window.js";
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
