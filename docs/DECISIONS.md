# Decision Log

## Confirmed by the user (2026-09-13)

| ID | Decision | Choice |
|---|---|---|
| D-01 | Backend stack | Node.js + Express + TypeScript |
| D-02 | Analysis & assistant engine | Deterministic rules + TF-IDF; **optional** Gemini phrasing |
| D-03 | Storage | SQLite file |

## Implementation choices — PENDING APPROVAL

These were needed to make the app work. Each has alternatives; confirm or change them.

| ID | Choice made | Alternatives | Where to change |
|---|---|---|---|
| D-04 | Built-in `node:sqlite` (no native addon) → requires Node ≥ 22.13 | `better-sqlite3` (native build), Prisma/Drizzle ORM | `server/src/db.ts` |
| D-05 | One repo, one `package.json`, frontend at root, backend in `server/` | npm workspaces, two separate apps | `package.json` |
| D-06 | Session = JWT in an httpOnly SameSite=Strict cookie, 7-day TTL, token-version revocation | Server-side session table; shorter TTL + refresh tokens | `server/src/security/session.ts`, `SESSION_TTL_HOURS` |
| D-07 | Exact pinned dependency versions (installed 2026-09-13, see package.json) | Caret ranges | `package.json` |
| D-08 | Component weights 0.35/0.25/0.15/0.10/0.10/0.05, **taken from the original frontend mock data** | Calibrate on a labelled set | `WEIGHTS` in `analyze.ts` |
| D-09 | Requirement weights required 1.0 / preferred 0.5; credit strong 1 / partial 0.5 / missing 0 | Other ratios; per-skill frequency weighting | `REQUIREMENT_WEIGHT`, `LEVEL_CREDIT` |
| D-10 | Strong = mentioned in Experience/Projects (or action-verb line); Partial = mentioned elsewhere | Require N mentions; semantic embedding threshold | `analyze.ts` |
| D-11 | Education is binary (meets / doesn't meet) | Partial credit for one level below | `analyze.ts` |
| D-13 | Upload/parse limits: 5 MB (from original UI), 20 PDF pages, 50 MB DOCX uncompressed, 2000 ZIP entries, 100k extracted chars, JD 50k chars, question 1k chars, min 50 chars text | Other values | `config.ts` |
| D-14 | Rate limits: api 300/15 min, auth 10/15 min, analysis 30/h, assistant 60/h | Other values; per-account limits | `middleware/security.ts` |
| D-15 | scrypt N=2^17, r=8, p=1 | Argon2id (needs native package), bcrypt | `security/password.ts` |
| D-16 | Password policy: 8–128 chars (8 from the original UI), no composition rules | Breached-password check, stronger minimum | `routes/auth.ts` |
| D-17 | Privacy mode on by default; redacts email/phone/URL in evidence; anonymises filename | Off by default; also redact names | `redact.ts`, DB default |
| D-18 | Gemini call settings: temperature 0.2, 600 max output tokens, 15 s timeout | Other values | `assistant/gemini.ts` |
| D-19 | Curated skill dictionary (~140 skills) and heading patterns written for this project | Import a published taxonomy (e.g. ESCO, O*NET) | `skills.ts`, `sections.ts` |
| D-20 | Signup returns 409 for an existing email (reveals registration) | Always "check your email" (needs email delivery) | `routes/auth.ts` |
| D-21 | History list capped at 100 most recent analyses | Pagination | `routes/analyses.ts` |
| D-22 | Roadmap order: missing required → missing preferred → partial → strong (original frontend listed strong first) | Keep original order | `RoadmapPage.tsx` |

## OPEN DECISION — requires user confirmation

| ID | Question |
|---|---|
| D-12 | Email notifications: the toggle is saved, but no emails are sent. Which provider (SMTP, Resend, SES…), if any? Also needed for email verification and password reset |
| D-23 | Gemini model name: none assumed. Set `GEMINI_MODEL` to the model you choose, or leave it unset for rules-only |
| D-24 | Learning resources in the Roadmap: the `resource` field is left empty; no URLs were invented. Provide an approved resource list if wanted |
| D-25 | Evaluation dataset: no accuracy metrics exist. Which resumes/JDs (with consent) should be used to calibrate D-08–D-11? |
| D-26 | Deployment target (Render, Railway, VPS, Docker…) and domain/HTTPS setup |
| D-27 | Data retention period for stored analyses (currently kept until the user deletes them) |
| D-28 | OCR for scanned PDFs (currently rejected with a clear message) |
