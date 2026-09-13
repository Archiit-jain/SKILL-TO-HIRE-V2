import { promises as dns } from "node:dns";
import MailChecker from "mailchecker";
import { config } from "../config.js";

export type EmailCheckResult = { ok: true } | { ok: false; code: "disposable_email" | "email_domain_invalid"; message: string };

export type EmailChecker = (email: string) => Promise<EmailCheckResult>;

const DNS_TIMEOUT_MS = 4000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error("dns_timeout")), ms))]);
}

const NOT_FOUND = new Set(["ENOTFOUND", "ENODATA", "NXDOMAIN"]);

/** true = domain can receive mail, false = definitely cannot, null = DNS inconclusive (timeout/server failure). */
async function domainAcceptsMail(domain: string): Promise<boolean | null> {
  try {
    const mx = await withTimeout(dns.resolveMx(domain), DNS_TIMEOUT_MS);
    // RFC 7505 "null MX" (a single record with exchange ".") explicitly means the domain accepts no mail.
    if (mx.length === 1 && (mx[0].exchange === "" || mx[0].exchange === ".")) return false;
    if (mx.length > 0) return true;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (!code || !NOT_FOUND.has(code)) return null;
  }
  // No MX record: SMTP falls back to the domain's address records (RFC 5321 §5.1).
  try {
    const a = await withTimeout(dns.resolve(domain), DNS_TIMEOUT_MS);
    return a.length > 0;
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    return code && NOT_FOUND.has(code) ? false : null;
  }
}

/**
 * Rejects disposable/temporary-mail providers and domains that cannot receive email. This only filters obvious
 * fakes - ownership of the address is proven by the verification link.
 */
export const defaultEmailChecker: EmailChecker = async (email) => {
  if (!MailChecker.isValid(email)) {
    return {
      ok: false,
      code: "disposable_email",
      message: "Temporary or disposable email addresses aren't allowed. Please use your real email.",
    };
  }
  if (config.emailDnsCheck) {
    const domain = email.slice(email.lastIndexOf("@") + 1);
    const accepts = await domainAcceptsMail(domain);
    if (accepts === false) {
      return { ok: false, code: "email_domain_invalid", message: `The domain "${domain}" can't receive email. Check for typos.` };
    }
    if (accepts === null) console.warn(`[email-check] DNS inconclusive for ${domain}; allowing (verification link still required)`);
  }
  return { ok: true };
};
