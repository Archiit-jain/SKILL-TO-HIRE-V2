import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const here = path.dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = path.resolve(here, "..");
export const PROJECT_ROOT = path.resolve(SERVER_ROOT, "..");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "production", "test"]).default("development"),
  // API_PORT is the dev/API port (Vite proxies to it). PORT is honoured in production, where hosts inject it.
  API_PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  PORT: z.coerce.number().int().min(1).max(65535).optional(),
  HOST: z.string().default("127.0.0.1"),
  APP_ORIGIN: z.string().url().default("http://localhost:5173"),
  DATABASE_PATH: z.string().default(path.join(SERVER_ROOT, "data", "skill2hire.db")),
  JWT_SECRET: z.string().min(32, "JWT_SECRET must be at least 32 characters").optional(),
  SESSION_TTL_HOURS: z.coerce.number().positive().default(168),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  GEMINI_API_KEY: z.string().optional(),
  GEMINI_MODEL: z.string().optional(),
});

const parsed = envSchema.safeParse(process.env);
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
  isProd: env.NODE_ENV === "production",
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
    maxBytes: 5 * 1024 * 1024, // matches the 5MB limit already shown in the UI
    maxPdfPages: 20,
    maxDocxUncompressedBytes: 50 * 1024 * 1024,
    maxZipEntries: 2000,
    maxExtractedChars: 100_000,
  },
  text: {
    maxJdChars: 50_000,
    minResumeChars: 50,
    minJdChars: 50,
    maxQuestionChars: 1_000,
  },
} as const;
