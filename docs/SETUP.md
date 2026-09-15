# Setup

## Prerequisites

| Tool | Version | Why |
|---|---|---|
| Node.js | 22.13 or newer (tested: 24.18.0) | `--env-file-if-exists`, worker-thread module hooks |
| npm | 10+ (tested: 11.16.0) | Package manager |

No database server, Python or native build tools are needed. Storage uses `@libsql/client`, which ships prebuilt
binaries: a local SQLite file in development, and a hosted Turso (libSQL) database in production (see below).

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
| `JWT_SECRET` | auto (dev only) | **Required in production**, at least 32 characters. The Vercel **production** deployment refuses to start without it; preview deployments fall back to a per-instance secret |
| `SESSION_TTL_HOURS` | `168` | Session cookie lifetime |
| `TURSO_DATABASE_URL` | — | Hosted libSQL database (`libsql://…`, `https://…` or `wss://…`). **Required for data to persist on Vercel** |
| `TURSO_AUTH_TOKEN` | — | Token for that database. Secret: set it in the host's environment, never commit it |
| `DATABASE_PATH` | `server/data/skill2hire.db` | Local SQLite file, used when `TURSO_DATABASE_URL` isn't set (on Vercel: `/tmp/skill2hire.db`, not persistent) |
| `TRUST_PROXY` | `false` | Set `true` behind a reverse proxy so rate limits see real client IPs |
| `GEMINI_API_KEY` | — | Optional. Enables Gemini phrasing in the assistant **only if `GEMINI_MODEL` is also set** |
| `GEMINI_MODEL` | — | Optional. No default is assumed. Choose one from Google's current model list |
| `GOOGLE_CLIENT_ID` | — | Optional. Enables "Sign in with Google" (see below) |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` / `SMTP_PASS` / `EMAIL_FROM` | — / `465` | Verification emails (see below). Required for email sign-up in production |
| `EMAIL_VERIFICATION_TTL_HOURS` | `24` | Verification link lifetime |
| `EMAIL_DNS_CHECK` | `true` | Reject email domains with no mail server (off in tests) |

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

## Sign in with Google (setup, ~5 minutes)

1. Open https://console.cloud.google.com/ and create (or pick) a project.
2. **APIs & Services → OAuth consent screen**: choose *External*, fill in the app name, support email and developer
   email, and add the scopes `openid`, `email`, `profile`. While the app is in *Testing*, add your teammates' Gmail
   addresses under **Test users** (or publish the app).
3. **APIs & Services → Credentials → Create credentials → OAuth client ID → Web application**.
4. Under **Authorised JavaScript origins** add:
   - `http://localhost`
   - `http://localhost:5173`
   - `https://skill-to-hire-v2.vercel.app` (your Vercel production domain)

   No redirect URI is needed (the app uses Google's popup flow).
5. Copy the **Client ID** (ends in `.apps.googleusercontent.com`) into `GOOGLE_CLIENT_ID`: in `.env` locally, and in
   Vercel (see below). The client ID is public by design; there is **no** client secret to configure.

Google-created accounts have a verified email and no password. Users can add a password later in Settings.

## Verification emails with Gmail SMTP (setup)

1. The Gmail account that sends the emails must have **2-Step Verification** on (Google Account → Security).
2. Create an **App Password**: Google Account → Security → 2-Step Verification → *App passwords* → name it
   "Skill2Hire" → copy the 16-character password.
3. Set:

   | Variable | Value |
   |---|---|
   | `SMTP_HOST` | `smtp.gmail.com` |
   | `SMTP_PORT` | `465` |
   | `SMTP_USER` | the Gmail address |
   | `SMTP_PASS` | the App Password (not your normal password) |
   | `EMAIL_FROM` | optional; defaults to `SMTP_USER` |

Gmail allows roughly 500 emails/day, which is plenty for a class project. Without SMTP:
- **development** prints each verification email (with its link) to the API console, so you can click it locally;
- **production/Vercel** disables email sign-up (the form explains why) while Google sign-in keeps working.

### Adding environment variables on Vercel

Vercel → project **skill-to-hire-v2** → **Settings → Environment Variables** → add `GOOGLE_CLIENT_ID`, `SMTP_HOST`,
`SMTP_PORT`, `SMTP_USER`, `SMTP_PASS` (and `JWT_SECRET`) for the *Production* environment → then **Deployments →
latest → Redeploy** so the new values are picked up.

## Persistent database (Turso)

Accounts, analyses, sessions, guest markers and Gemini quotas live in one database. Locally that is a SQLite file.
On Vercel the function filesystem is temporary, so use a hosted libSQL database from [Turso](https://turso.tech):

1. Install the Turso CLI and log in (see Turso's documentation for your OS), then create a database, e.g.:

   ```bash
   turso db create skill2hire
   ```

2. Get its URL and create a token:

   ```bash
   turso db show skill2hire --url
   ```

   ```bash
   turso db tokens create skill2hire
   ```

3. In Vercel → project → **Settings → Environment Variables**, add `TURSO_DATABASE_URL` (the `libsql://…` URL) and
   `TURSO_AUTH_TOKEN` for the environments that should persist data (Production, and Preview if wanted), then redeploy.
4. Check `GET /api/auth/providers`: `"persistentStorage": true` means the hosted database is in use, and the
   "Temporary storage" banner disappears.

The schema is created and migrated automatically on first start (tracked in the `schema_version` table). A malformed
`TURSO_DATABASE_URL` stops start-up instead of silently falling back to temporary storage. Tests never use Turso: they run
on private in-memory databases.

Running your own server (`npm start`) with a local `DATABASE_PATH` on a persistent disk is also persistent; a
database file created by an earlier version (tracked with `PRAGMA user_version`) is upgraded in place.

## Vercel deployment

The repo deploys to Vercel as a static Vite site plus one serverless function:

- `vercel.json` builds with `vite build` into `dist/` and rewrites `/api/*` to `api/index.ts`, which exports the Express app.
- When `VERCEL` is set, the server automatically:
  - uses the hosted database from `TURSO_DATABASE_URL`/`TURSO_AUTH_TOKEN` when set (persistent, shared by every instance).
    **Without them** it falls back to SQLite at `/tmp/skill2hire.db`, which is temporary: data resets whenever Vercel
    recycles the function instance and isn't shared between instances. The API then reports `persistentStorage: false`
    and the frontend shows a "Temporary storage" banner;
  - trusts the Vercel proxy (`TRUST_PROXY=true`) so rate limits and the CSRF origin check see the real client;
  - on **preview** deployments, uses a per-instance random session secret if `JWT_SECRET` isn't set. The
    **production** deployment refuses to start without `JWT_SECRET` (security remediation P1), so set it in the
    Vercel project's Production environment variables before deploying `main`;
  - limits uploads to **4 MB**, because Vercel rejects request bodies over 4.5 MB;
  - parses documents in a worker thread with a 20 s deadline (P2). If the preview logs show
    `[parse] worker unavailable: <reason>`, the worker file wasn't bundled and parsing runs on the main thread without
    the ability to stop a slow document.
- The "Temporary storage" banner is driven by the server's real storage state, not by the build: a Vercel deployment
  with Turso configured shows no banner.

Rate-limit and failed-login counters stay in memory per instance (see SECURITY.md); the database-backed limits (guest
free analysis, Gemini quotas) are shared across instances once Turso is configured.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| "Cannot reach the server. Is the backend running?" | The API isn't running. Use `npm run dev`, not only `npm run dev:web` |
| API starts on an unexpected port | In development only `API_PORT` is used; `PORT` is ignored outside production |
| `JWT_SECRET is required in production` | Set it in `.env` or the host's environment |
| "Could not find enough text in the resume" | Scanned/image-only PDFs have no text layer. OCR is not supported |
| 403 "Missing CSRF header" when calling the API by hand | Send `X-Requested-With: skill2hire` on POST/PUT/PATCH/DELETE |
| 429 Too many requests | Rate limit hit (see [SECURITY.md](SECURITY.md)); wait for the window to reset |
| "Temporary storage" banner on Vercel | `TURSO_DATABASE_URL` isn't set for that environment. See *Persistent database (Turso)* |
| Start-up error `TURSO_DATABASE_URL must start with libsql://, https:// or wss://` | Copy the URL from `turso db show <name> --url` |
| API answers `503 database_unavailable` on Vercel | The hosted database couldn't be opened (wrong token, database deleted). Check the Vercel function logs |
| "Email sign-up isn't available on this deployment yet" | SMTP isn't configured on the server. Set the SMTP_* variables, or use Google sign-in |
| Verification link says "invalid or has expired" on Vercel | The link is older than 24 h or was already used. Without Turso, the temporary database may also have been recycled (D-29) |
| Google button missing | `GOOGLE_CLIENT_ID` not set on the server (check `GET /api/auth/providers`) |
| Google popup error "origin_mismatch" | Add the exact site URL to *Authorised JavaScript origins* in Google Cloud Console |
| Gmail "Invalid login" / 535 in the server log | `SMTP_PASS` must be an App Password, and 2-Step Verification must be on |
