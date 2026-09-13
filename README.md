# Skill2Hire — AI Resume Analyzer

Upload a resume (PDF/DOCX) and a job description, get an evidence-backed match score, strong/partial/missing
skills, a "Why Not Me?" explanation, a career roadmap, a career assistant and a progress history.

**Stack:** React 18 + TypeScript + Vite + Tailwind/shadcn-ui (frontend) · Node.js + Express 5 + TypeScript (backend) ·
SQLite via Node's built-in `node:sqlite` · optional Google Gemini for assistant phrasing.

## Quick start

Requires **Node.js 22.13+** (tested on Node 24.18, npm 11.16).

```bash
npm install
```

```bash
npm run dev
```

Open http://localhost:5173 and create an account. The API runs on http://127.0.0.1:4000 and Vite proxies `/api` to it.

| Command | What it does |
|---|---|
| `npm run dev` | API (watch mode) + Vite dev server together |
| `npm test` | 37 backend tests (analysis engine, auth, security, uploads, user isolation) |
| `npm run typecheck` | Type-check frontend and backend |
| `npm run build` | Type-check + production frontend build into `dist/` |
| `npm start` | Production server: API + built frontend on one origin (needs `JWT_SECRET`) |

Copy `.env.example` to `.env` to change settings. Nothing is required for development.

## Documentation

See [docs/README.md](docs/README.md). It covers setup, architecture, the API reference, how scoring works, the
security review and patches, testing, and the list of decisions still pending your approval.
