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

## Vercel preview deployment (for teammates)

The repo deploys to Vercel as a static Vite site plus one serverless function:

- `vercel.json` builds with `vite build` into `dist/` and rewrites `/api/*` to `api/index.ts`, which exports the Express app.
- When `VERCEL` is set, the server automatically:
  - stores SQLite at `/tmp/skill2hire.db`. **This is temporary:** accounts and analyses reset whenever Vercel recycles the function instance (after idle periods or on redeploy);
  - trusts the Vercel proxy (`TRUST_PROXY=true`) so rate limits and the CSRF origin check see the real client;
  - uses a per-instance random session secret if `JWT_SECRET` isn't set;
  - limits uploads to **4 MB**, because Vercel rejects request bodies over 4.5 MB.
- The frontend shows a yellow "Preview build" banner on Vercel builds only.

For persistent data on Vercel, move to a hosted database (Turso/libSQL or Neon Postgres) and set `JWT_SECRET` in
the Vercel project's environment variables. See DECISIONS.md D-29.

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
| "Email sign-up isn't available on this deployment yet" | SMTP isn't configured on the server. Set the SMTP_* variables, or use Google sign-in |
| Verification link says "invalid or has expired" on Vercel | The link is older than 24 h, was already used, or Vercel recycled the temporary database (D-29). Sign up again or use Google |
| Google button missing | `GOOGLE_CLIENT_ID` not set on the server (check `GET /api/auth/providers`) |
| Google popup error "origin_mismatch" | Add the exact site URL to *Authorised JavaScript origins* in Google Cloud Console |
| Gmail "Invalid login" / 535 in the server log | `SMTP_PASS` must be an App Password, and 2-Step Verification must be on |
