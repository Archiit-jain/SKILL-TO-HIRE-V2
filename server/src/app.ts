import { existsSync } from "node:fs";
import path from "node:path";
import cookieParser from "cookie-parser";
import express, { type NextFunction, type Request, type Response } from "express";
import { MulterError } from "multer";
import { config, PROJECT_ROOT } from "./config.js";
import type { Db } from "./db.js";
import { defaultDeps, type AppDeps } from "./deps.js";
import { HttpError } from "./http.js";
import { csrfProtection, securityHeaders } from "./middleware/security.js";
import { accountRouter } from "./routes/account.js";
import { analysesRouter } from "./routes/analyses.js";
import { assistantRouter } from "./routes/assistant.js";
import { authRouter } from "./routes/auth.js";

export function createApp(db: Db, overrides: Partial<AppDeps> = {}) {
  const deps = defaultDeps(overrides);
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", config.trustProxy ? 1 : false);
  app.use(securityHeaders);

  const api = express.Router();
  api.use(deps.ipLimiters.api);
  api.use(express.json({ limit: "100kb" }));
  api.use(cookieParser());
  api.use(csrfProtection);
  api.use((_req, res, next) => {
    res.set("Cache-Control", "no-store");
    next();
  });

  api.get("/health", (_req, res) => {
    // L-4 (P2): production answers only {status}; assistant mode and storage details are for development and tests.
    res.json(deps.healthDetails ? { status: "ok", assistant: deps.gemini ? "gemini" : "rules", ephemeralStorage: config.onVercel } : { status: "ok" });
  });
  api.use("/auth", authRouter(db, deps));
  api.use("/account", accountRouter(db, deps));
  api.use("/analyses", analysesRouter(db, deps));
  api.use("/assistant", assistantRouter(db, deps));
  api.use((_req, _res, next) => next(new HttpError(404, "Not found", "not_found")));
  app.use("/api", api);

  // Production: serve the built frontend from the same origin.
  const dist = path.join(PROJECT_ROOT, "dist");
  if (config.isProd && existsSync(dist)) {
    app.use(express.static(dist, { index: false, maxAge: "1h" }));
    app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(dist, "index.html")));
  }

  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof HttpError) {
      if (err.headers) res.set(err.headers);
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (err instanceof MulterError) {
      const message =
        err.code === "LIMIT_FILE_SIZE" ? `File size exceeds ${config.upload.maxBytes / (1024 * 1024)}MB limit` : "Invalid upload";
      return res.status(err.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: { code: "upload", message } });
    }
    const status = (err as { status?: number; type?: string }).status;
    if (status && status >= 400 && status < 500) {
      // body-parser errors (malformed JSON, payload too large)
      return res.status(status).json({ error: { code: "bad_request", message: "Malformed request" } });
    }
    // P2 log hardening: the error class and stack frames only. The message line is left out because it can quote
    // request data (e.g. parser or database messages).
    const e = err as { name?: string; stack?: string };
    console.error(`[server] unhandled error: ${e?.name ?? typeof err}`, (e?.stack ?? "").split("\n").slice(1, 8).join("\n"));
    // Never leak stack traces or internal messages to the client.
    res.status(500).json({ error: { code: "internal", message: "Something went wrong" } });
  });

  return app;
}
