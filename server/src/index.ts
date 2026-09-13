import { createApp } from "./app.js";
import { config } from "./config.js";
import { openDb } from "./db.js";

const db = openDb();
const app = createApp(db);

const server = app.listen(config.port, config.host, () => {
  console.log(`[server] Skill2Hire API on http://${config.host}:${config.port} (${config.env})`);
  console.log(`[server] Career assistant mode: ${config.gemini ? `gemini (${config.gemini.model})` : "rules (set GEMINI_API_KEY and GEMINI_MODEL to enable Gemini)"}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
