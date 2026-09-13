// Vercel serverless entry point. vercel.json rewrites every /api/* request here; Express routes on the original path.
// Local development and `npm start` use server/src/index.ts instead.
import { createApp } from "../server/src/app.js";
import { openDb } from "../server/src/db.js";

const app = createApp(openDb());

export default app;
