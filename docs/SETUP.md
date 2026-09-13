# Setup

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22.13 or newer (tested: 24.18.0) | Backend uses the built-in `node:sqlite` module and `--env-file-if-exists` |
| npm | 10+ (tested: 11.16.0) | Package manager |

No database server, Python or native build tools are needed. SQLite is built into Node.

## Install

```bash
npm install
```

All dependency versions are pinned exactly in `package.json` (see [DECISIONS.md](DECISIONS.md) D-07).

## Run in development

```bash
npm run dev
```

- Frontend: http://localhost:5173 (Vite, hot reload)
- API: http://127.0.0.1:4000 (tsx watch, restarts on change)
- Vite proxies `/api/*` to the API, so the browser only sees a single origin, which the cookie and CSRF design relies on.
- The database is created on first start at `server/data/skill2hire.db`.
- A development JWT secret is generated once at `server/data/.dev-jwt-secret`.

Run the parts separately with `npm run dev:server` and `npm run dev:web`.

## Environment variables

Copy `.env.example` to `.env`. Every variable is optional in development.

| Variable | Default | Notes |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables secure cookies, HSTS and static serving of `dist/` |
| `HOST` | `127.0.0.1` | Use `0.0.0.0` inside containers |
| `API_PORT` | `4000` | API port in development; Vite reads it for the proxy |
| `PORT` | — | Used instead of `API_PORT` when `NODE_ENV=production` (hosting platforms inject it) |
| `APP_ORIGIN` | `http://localhost:5173` | Public URL of the app; used by the CSRF origin check |
| `JWT_SECRET` | auto (dev only) | **Required in production**, at least 32 characters |
| `SESSION_TTL_HOURS` | `168` | Session cookie lifetime |
| `DATABASE_PATH` | `server/data/skill2hire.db` | SQLite file |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy so rate limits see real client IPs |
| `GEMINI_API_KEY` | — | Optional. Enables Gemini phrasing in the assistant **only if `GEMINI_MODEL` is also set** |
| `GEMINI_MODEL` | — | Optional. No default is assumed. Choose one from Google's current model list |

Generate a production secret:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

## Run in production (single server)

```bash
npm run build
```

```bash
npm start
```

`npm start` sets `NODE_ENV=production`. Express serves `dist/` and `/api` from the same origin. Put it behind HTTPS
(nginx, Caddy or a platform proxy): the session cookie is `Secure` in production and browsers only send it over
HTTPS (localhost excepted). Set `APP_ORIGIN` to the public URL and `TRUST_PROXY=true` when behind a proxy.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Cannot reach the server. Is the backend running?" | The API isn't running. Use `npm run dev`, not only `npm run dev:web` |
| API starts on an unexpected port | In development only `API_PORT` is used; `PORT` is ignored outside production |
| `JWT_SECRET is required in production` | Set it in `.env` or the host's environment |
| "Could not find enough text in the resume" | Scanned/image-only PDFs have no text layer. OCR is not supported |
| 403 "Missing CSRF header" when calling the API by hand | Send `X-Requested-With: skill2hire` on POST/PUT/PATCH/DELETE |
| 429 Too many requests | Rate limit hit (see [SECURITY.md](SECURITY.md)); wait for the window to reset |
| `ExperimentalWarning: SQLite` in the console | Harmless on some Node versions |
