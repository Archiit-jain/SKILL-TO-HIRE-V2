// Vercel serverless entry point. vercel.json rewrites every /api/* request here; Express routes on the original path.
// Local development and `npm start` use server/src/index.ts instead.
import type { Request, Response } from "express";
import { createApp } from "../server/src/app.js";
import { openDb } from "../server/src/db.js";

// Opened once per function instance. A failed open (e.g. a bad TURSO_DATABASE_URL) is retried on the next request.
let appPromise: Promise<ReturnType<typeof createApp>> | null = null;

export default async function handler(req: Request, res: Response) {
  appPromise ??= openDb().then((db) => createApp(db));
  let app: ReturnType<typeof createApp>;
  try {
    app = await appPromise;
  } catch (err) {
    appPromise = null;
    console.error(`[api] database unavailable: ${(err as Error).name}`);
    res.status(503).json({ error: { code: "database_unavailable", message: "The service is temporarily unavailable. Please try again." } });
    return;
  }
  app(req, res);
}
