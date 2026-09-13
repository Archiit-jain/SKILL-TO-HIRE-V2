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
  // On Vercel only /tmp is writable, and it is wiped whenever the function instance is recycled.
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

/**
 * Production must supply JWT_SECRET. In development a random secret is generated once and kept in
 * server/data so sessions survive `tsx watch` restarts. Tests get a fresh in-memory secret.
 */
function resolveJwtSecret(): string {
  if (env.JWT_SECRET) return env.JWT_SECRET;
  if (ON_VERCEL) {
    // Preview deployments without a configured secret: a per-instance secret matches the per-instance /tmp database.
    // Set JWT_SECRET in the Vercel project settings once a persistent database is added.
    console.warn("[config] JWT_SECRET not set; using an ephemeral per-instance secret (sessions reset with the instance)");
    return randomBytes(48).toString("hex");
  }
  if (env.NODE_ENV === "production") {
    console.error("JWT_SECRET is required in production (min 32 chars). See docs/SETUP.md.");
    process.exit(1);
  }
  if (env.NODE_ENV === "test") return randomBytes(48).toString("hex");
  const file = path.join(SERVER_ROOT, "data", ".dev-jwt-secret");
  mkdirSync(path.dirname(file), { recursive: true });
  if (!existsSync(file)) writeFileSync(file, randomBytes(48).toString("hex"), { mode: 0o600 });
  return readFileSync(file, "utf8").trim();
}

export const config = {
  env: env.NODE_ENV,
  isProd: env.NODE_ENV === "production" || ON_VERCEL,
  onVercel: ON_VERCEL,
  isTest: env.NODE_ENV === "test",
  port: env.NODE_ENV === "production" ? (env.PORT ?? env.API_PORT) : env.API_PORT,
  host: env.HOST,
  appOrigin: env.APP_ORIGIN.replace(/\/$/, ""),
  databasePath: env.NODE_ENV === "test" ? ":memory:" : env.DATABASE_PATH,
  jwtSecret: resolveJwtSecret(),
  sessionTtlSeconds: Math.round(env.SESSION_TTL_HOURS * 3600),
  trustProxy: env.TRUST_PROXY === "true",
  gemini:
    env.GEMINI_API_KEY && env.GEMINI_MODEL ? { apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL } : null,
  upload: {
    // 5MB matches the original UI. Vercel functions reject request bodies over 4.5MB, so the preview uses 4MB.
    maxBytes: (ON_VERCEL ? 4 : 5) * 1024 * 1024,
    maxPdfPages: 20,
    maxDocxUncompressedBytes: 50 * 1024 * 1024,
    maxZipEntries: 2000,
    maxExtractedChars: 100_000,
  },
  googleClientId: env.GOOGLE_CLIENT_ID ?? null,
  smtp:
    env.SMTP_HOST && env.SMTP_USER && env.SMTP_PASS
      ? { host: env.SMTP_HOST, port: env.SMTP_PORT, user: env.SMTP_USER, pass: env.SMTP_PASS, from: env.EMAIL_FROM ?? env.SMTP_USER }
      : null,
  emailVerificationTtlSeconds: Math.round(env.EMAIL_VERIFICATION_TTL_HOURS * 3600),
  emailDnsCheck: env.EMAIL_DNS_CHECK === "true" && env.NODE_ENV !== "test",
  text: {
    maxJdChars: 50_000,
    minResumeChars: 50,
    minJdChars: 50,
    maxQuestionChars: 1_000,
  },
} as const;
