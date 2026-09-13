import { config } from "./config.js";
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
}

export function defaultDeps(overrides: Partial<AppDeps> = {}): AppDeps {
  return {
    mailer: overrides.mailer ?? createMailer(),
    checkEmail: overrides.checkEmail ?? defaultEmailChecker,
    verifyGoogle: overrides.verifyGoogle ?? defaultGoogleVerifier,
    googleClientId: overrides.googleClientId !== undefined ? overrides.googleClientId : config.googleClientId,
  };
}
