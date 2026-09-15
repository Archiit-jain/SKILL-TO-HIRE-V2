import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, "..");
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, "..");

/** Running as a Vercel serverless function: read-only filesystem except /tmp, HTTPS proxy in front. */
export const ON_VERCEL = !!process.env.VERCEL;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // API_PORT is the dev/API port (Vite proxies to it). PORT is honoured in production, where hosts inject it.
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  HOST: z.string().default("127.0.0.1"),
  // Public URL of the app; used for the CSRF origin check and for links in emails (never taken from request headers).
  APP_ORIGIN: z
    .string()
    .url()
    .default(
      process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:5173"
    ),
  // Persistent hosted database (Turso/libSQL). Required for data to persist on Vercel; e.g. libsql://<db>-<org>.turso.io
  TURSO_DATABASE_URL: z.string().optional(),
  TURSO_AUTH_TOKEN: z.string().optional(),
  // Local SQLite file used when TURSO_DATABASE_URL is not set. On Vercel only /tmp is writable, and it is wiped whenever
  // the function instance is recycled, so that fallback is NOT persistent.
  DATABASE_PATH: z.string().default(ON_VERCEL ? "/tmp/skill2hire.db" : path.join(SERVER_ROOT, "data", "skill2hire.db")),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  TRUST_PROXY: z.enum(["true", "false"]).default(ON_VERCEL ? "true" : "false"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
  // Google sign-in (OAuth 2.0 Web client ID from Google Cloud Console). Unset = Google button hidden.
  GOOGLE_CLIENT_ID: z.string().optional(),
  // SMTP for verification emails, e.g. Gmail: smtp.gmail.com / 465 / your address / a Google App Password.
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  EMAIL_FROM: z.string().optional(),
  EMAIL_VERIFICATION_TTL_HOURS: z.coerce.number().positive().default(24),
  // DNS check that the email domain can receive mail. Disabled automatically in tests.
  EMAIL_DNS_CHECK: z.enum(["true", "false"]).default("true"),
});

// Treat empty values (e.g. "JWT_SECRET=" copied from .env.example) as unset.
const rawEnv = Object.fromEntries(Object.entries(process.env).filter(([, v]) => v !== ""));
const parsed = envSchema.safeParse(rawEnv);
if (!parsed.success) {
  console.error("Invalid environment configuration:\n" + z.prettifyError(parsed.error));
  process.exit(1);
}
const env = parsed.data;

export class MissingJwtSecretError extends Error {}

export interface JwtSecretContext {
  jwtSecret?: string;
  nodeEnv: "development" | "production" | "test";
  onVercel: boolean;
  /** Vercel's VERCEL_ENV: "production", "preview" or "development". */
  vercelEnv?: string;
}

/**
 * Production must supply JWT_SECRET, including the Vercel production deployment (security remediation P1, M-8): a
 * missing secret stops start-up. Vercel preview deployments may still use a per-instance secret, which matches their
 * per-instance /tmp database. In development a random secret is generated once and kept in server/data so sessions
 * survive `tsx watch` restarts. Tests get a fresh in-memory secret.
 */
export function resolveJwtSecret(ctx: JwtSecretContext): string {
  if (ctx.jwtSecret) return ctx.jwtSecret;
  if (ctx.onVercel && ctx.vercelEnv === "production") {
    throw new MissingJwtSecretError("JWT_SECRET is required on the Vercel production deployment (min 32 chars). See docs/SETUP.md.");
  }
  if (ctx.onVercel) {
    console.warn("[config] JWT_SECRET not set; using an ephemeral per-instance secret (sessions reset with the instance)");
    return randomBytes(48).toString("hex");
  }
  if (ctx.nodeEnv === "production") {
    throw new MissingJwtSecretError("JWT_SECRET is required in production (min 32 chars). See docs/SETUP.md.");
  }
  if (ctx.nodeEnv === "test") return randomBytes(48).toString("hex");
  const file = path.join(SERVER_ROOT, "data", ".dev-jwt-secret");
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

export interface DatabaseConfig {
  /** libsql://… (hosted), a file path (local SQLite) or ":memory:" (tests). */
  url: string;
  authToken?: string;
  /** True when stored data would be lost whenever the instance is recycled (Vercel without a hosted database). */
  ephemeral: boolean;
}

/**
 * Where data is stored. A hosted libSQL database (Turso) when TURSO_DATABASE_URL is set; otherwise a local SQLite file,
 * which is persistent on a normal server but not on Vercel, where only the per-instance /tmp is writable. Tests always
 * use a private in-memory database.
 */
export function resolveDatabaseConfig(ctx: {
  nodeEnv: "development" | "production" | "test";
  onVercel: boolean;
  tursoUrl?: string;
  tursoAuthToken?: string;
  databasePath: string;
}): DatabaseConfig {
  if (ctx.nodeEnv === "test") return { url: ":memory:", ephemeral: false };
  if (ctx.tursoUrl) {
    if (!/^(libsql|https|wss):\/\//i.test(ctx.tursoUrl)) {
      throw new Error("TURSO_DATABASE_URL must start with libsql://, https:// or wss:// (see docs/SETUP.md)");
    }
    return { url: ctx.tursoUrl, authToken: ctx.tursoAuthToken, ephemeral: false };
  }
  return { url: ctx.databasePath, ephemeral: ctx.onVercel };
}

function jwtSecretOrExit(): string {
  try {
    return resolveJwtSecret({ jwtSecret: env.JWT_SECRET, nodeEnv: env.NODE_ENV, onVercel: ON_VERCEL, vercelEnv: process.env.VERCEL_ENV });
  } catch (err) {
    if (!(err instanceof MissingJwtSecretError)) throw err;
    console.error(err.message);
    process.exit(1);
  }
}

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === "production" || ON_VERCEL,
  onVercel: ON_VERCEL,
  isTest: env.NODE_ENV === "test",
  port: env.NODE_ENV === "production" ? (env.PORT ?? env.API_PORT) : env.API_PORT,
  host: env.HOST,
  appOrigin: env.APP_ORIGIN.replace(/\/$/, ""),
  database: resolveDatabaseConfig({
    nodeEnv: env.NODE_ENV,
    onVercel: ON_VERCEL,
    tursoUrl: env.TURSO_DATABASE_URL,
    tursoAuthToken: env.TURSO_AUTH_TOKEN,
    databasePath: env.DATABASE_PATH,
  }),
  jwtSecret: jwtSecretOrExit(),
  sessionTtlSeconds: Math.round(env.SESSION_TTL_HOURS * 3600),
  trustProxy: env.TRUST_PROXY === "true",
  gemini:
    env.GEMINI_API_KEY && env.GEMINI_MODEL ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null,
  upload: {
    // 5MB matches the original UI. Vercel functions reject request bodies over 4.5MB, so the preview uses 4MB.
    maxBytes: (ON_VERCEL ? 4 : 5) * 1024 * 1024,
    // D-4: PDFs with more pages are rejected (page count checked before any text is extracted).
    maxPdfPages: 20,
    // Document safety caps (security remediation P0, owner decisions D-2 / D-3 / D-5). Checked before any parser runs.
    // D-2: sum of all declared DOCX entry sizes.
    maxDocxUncompressedBytes: 20 * 1024 * 1024,
    // D-2: every part mammoth may read as XML (.xml/.rels and any relationship target), individually and in total.
    maxDocxXmlPartBytes: 4 * 1024 * 1024,
    maxDocxXmlTotalBytes: 4 * 1024 * 1024,
    maxZipEntries: 2000,
    // D-3: decompressed size of one PDF Flate stream, and of all Flate streams in one PDF.
    maxPdfStreamInflatedBytes: 10 * 1024 * 1024,
    maxPdfTotalInflatedBytes: 30 * 1024 * 1024,
    // D-5: documents parsed at the same time per server instance; extra requests get 503 with Retry-After.
    maxConcurrentParses: 2,
    busyRetryAfterSeconds: 5,
    // D-11 (P2): all document extraction for one upload request must finish within this time; otherwise the parse
    // worker is terminated and the request gets 422 file_too_complex. Leaves room for the rest of the request inside Vercel's
    // 30 s function limit (two cap-sized PDFs parsed at once took 26-28 s locally in P0).
    parseTimeoutMs: 20_000,
    // D-4: resume text (after cleaning) longer than this is rejected, never truncated.
    maxExtractedChars: 100_000,
  },
  googleClientId: env.GOOGLE_CLIENT_ID ?? null,
  smtp:
    env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
      ? { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.EMAIL_FROM ?? env.SMTP_USER }
      : null,
  emailVerificationTtlSeconds: Math.round(env.EMAIL_VERIFICATION_TTL_HOURS * 3600),
  emailDnsCheck: env.EMAIL_DNS_CHECK === "true" && env.NODE_ENV !== "test",
  // Security remediation P1 (approved owner decisions).
  security: {
    // D-5: concurrent scrypt operations per instance, and how long a request waits for one before 503 server_busy.
    maxConcurrentPasswordHashes: 2,
    passwordHashWaitMs: 5_000,
    passwordBusyRetryAfterSeconds: 5,
    // D-8: failed logins per account and assistant requests per user, fixed windows, in memory per instance (D-1).
    failedLoginsPerAccount: 5,
    failedLoginWindowMs: 15 * 60_000,
    assistantRequestsPerUser: 60,
    assistantWindowMs: 60 * 60_000,
    // D-6: unclaimed guest results are kept 30 days; the "free analysis used" marker 365 days.
    guestAnalysisRetentionDays: 30,
    guestFreeUseRetentionDays: 365,
    // D-9: Gemini answers per user per UTC day, and across all users per UTC day.
    geminiAnswersPerUserPerDay: 20,
    geminiAnswersGlobalPerDay: 500,
  },
  text: {
    // D-4: pasted JD (trimmed) or JD file text (after cleaning) longer than this is rejected, never truncated.
    maxJdChars: 50_000,
    minResumeChars: 50,
    minJdChars: 50,
    maxQuestionChars: 1_000,
  },
} as const;
