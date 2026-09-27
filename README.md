# Skill2Hire — Resume-to-Job Matching with Evidence

Upload a resume (PDF/DOCX) and a job description. Skill2Hire reads the job description into required and preferred
requirements, rates each skill Strong, Partial or Missing with the resume line and JD sentence behind it, explains
how the score was calculated, and turns the gaps into prioritised recommendations and a roadmap. A career assistant
answers questions from the analysis, and a progress view tracks re-analyses by role.

Scoring is deterministic and rule-based (see [docs/SCORING.md](docs/SCORING.md)); it has **not** been validated as a
hiring predictor. Try it without uploading anything: **Try Demo Analysis** runs the real engine on a synthetic sample.

**Stack:** React 18 + TypeScript + Vite + Tailwind with a light/dark green theme and self-hosted fonts (frontend) ·
Node.js + Express 5 + TypeScript (backend) ·
libSQL via `@libsql/client` (Turso in production, a SQLite file locally) · optional Google Gemini to reword assistant
answers (never scores).

## Quick start

Requires **Node.js 22.13+** (tested on Node 24.18, npm 11.16).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173. Try the sample, run one free analysis as a guest, or create an account. The API runs on
http://127.0.0.1:4000 and Vite proxies `/api` to it.

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) + Vite dev server together |
| `npm test` | 276 backend tests (analysis engine, persistence, auth, security, uploads, user isolation, end-to-end journey) |
| `npm run typecheck` | Type-check frontend and backend |
| `npm run build` | Type-check + production frontend build into `dist/` |
| `npm start` | Production server: API + built frontend on one origin (needs `JWT_SECRET`) |

Copy `.env.example` to `.env` to change settings. Nothing is required for development. For persistent data on Vercel,
set `TURSO_DATABASE_URL` and `TURSO_AUTH_TOKEN` ([docs/SETUP.md](docs/SETUP.md#persistent-database-turso)).

## Documentation

See [docs/README.md](docs/README.md). It covers setup, architecture, the API reference, how scoring works, the
security review and patches, testing, and the list of decisions still pending your approval.
