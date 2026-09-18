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
| D-13 | Upload/parse limits: 5 MB (from original UI), 20 PDF pages, ~~50 MB~~ **20 MB** DOCX uncompressed (changed by SEC-D2), 2000 ZIP entries, 100k extracted chars, JD 50k chars, question 1k chars, min 50 chars text | Other values | `config.ts` |
| D-14 | Rate limits: api 300/15 min, auth 10/15 min, analysis 30/h, assistant 60/h | Other values; per-account limits | `middleware/security.ts` |
| D-15 | scrypt N=2^17, r=8, p=1 | Argon2id (needs native package), bcrypt | `security/password.ts` |
| D-16 | Password policy: 8–128 chars (8 from the original UI), no composition rules | Breached-password check, stronger minimum | `routes/auth.ts` |
| D-17 | Privacy mode on by default; redacts email/phone/URL in evidence; anonymises filename | Off by default; also redact names | `redact.ts`, DB default |
| D-18 | Gemini call settings: temperature 0.2, 1024 max output tokens, thinking level LOW on 3.x models (retried without it if a model rejects the level), 15 s timeout; any non-STOP finish (e.g. truncated) falls back to the rule-based answer | Other values | `assistant/gemini.ts` |
| D-19 | Curated skill dictionary (~140 skills) and heading patterns written for this project | Import a published taxonomy (e.g. ESCO, O*NET) | `skills.ts`, `sections.ts` |
| D-20 | Signup returns 409 for an existing email (reveals registration) | Always "check your email" (needs email delivery) | `routes/auth.ts` |
| D-21 | History list capped at 100 most recent analyses | Pagination | `routes/analyses.ts` |
| D-22 | Roadmap order: missing required → missing preferred → partial → strong (original frontend listed strong first) | Keep original order | `RoadmapPage.tsx` |

## OPEN DECISION — requires user confirmation

| ID | Question |
|---|---|
| D-12 | Email notifications: the toggle is saved, but no notification emails are sent (verification emails now use Gmail SMTP, D-36). Password-reset emails are also not built yet |
| D-23 | Gemini model: **user chose `gemini-3.8-flash` (2026-09-13)** from the models their key lists. Set per environment in `GEMINI_MODEL` (local `.env`, Vercel env vars) |
| D-24 | Learning resources in the Roadmap: the `resource` field is left empty; no URLs were invented. Provide an approved resource list if wanted |
| D-25 | Evaluation dataset: no accuracy metrics exist. Which resumes/JDs (with consent) should be used to calibrate D-08–D-11? |
| D-26 | Deployment target (Render, Railway, VPS, Docker…) and domain/HTTPS setup |
| D-27 | Data retention period for stored analyses (currently kept until the user deletes them) |
| D-28 | OCR for scanned PDFs (currently rejected with a clear message) |
| D-29 | **Resolved by HR-1 (hackathon release): Turso/libSQL.** Original note: with temporary storage, a verification link can fail ("invalid or expired") if Vercel recycled the instance between sign-up and the click, and accounts disappear. Persistent database for the Vercel deployment: the preview uses temporary `/tmp` SQLite (data resets). Options: Turso (libSQL, closest to SQLite), Neon Postgres, or hosting the API elsewhere (Render/Railway) with a disk. Requires a user-created account |

## Account & access decisions (2026-09-13, confirmed by user)

| ID | Decision | Status |
|---|---|---|
| D-32 | One free analysis without login; the second forces login | Confirmed |
| D-33 | "Sign in with Google" via Google Identity Services (popup + server-side ID-token verification) | Confirmed. **OPEN:** user must create the OAuth client ID (docs/SETUP.md) |
| D-34 | Guest limit enforced by browser cookie only (not IP) so shared college Wi-Fi isn't blocked | Confirmed |
| D-35 | Block disposable/temp emails and domains with no mail server; require a verification link before first login | Confirmed |
| D-36 | Email delivery via Gmail SMTP (nodemailer, generic SMTP so Brevo/Outlook also work) | Confirmed. **OPEN:** user must create an App Password and set SMTP_* env vars |
| D-37 | Vercel Authentication (deployment protection) turned off so teammates can open the link | Confirmed and applied |

### PENDING APPROVAL (values chosen to implement the above)

| ID | Choice | Alternatives |
|---|---|---|
| D-38 | Verification link valid 24 h (`EMAIL_VERIFICATION_TTL_HOURS`) | 1 h, 72 h |
| D-39 | Resend cooldown 60 s per account | 30 s, 5 min |
| D-40 | DNS check fails **open** on timeout/SERVFAIL (4 s timeout) | Fail closed |
| D-41 | Disposable list from `mailchecker` 6.0.21 | `disposable-email-domains-js`, custom list |
| D-42 | Unverified password account + later Google sign-in with same email → Google wins, password removed | Refuse and ask user to verify first |
| D-43 | Email change keeps the current session but requires verification before the next login | Keep old email until the new one is verified (pending-email flow) |
| D-44 | Guest cookie lifetime 1 year; guest results kept until claimed (on Vercel they vanish with the temp DB anyway) | Shorter lifetime; periodic purge |
| D-45 | ~~Duplicate sign-up still returns 409 (reveals registration), as in D-20~~ → changed by SEC-D10 (P2): always the same 201; the owner is told by email | Always "check your email" |

## Deployment decisions (2026-09-13)

| ID | Decision | Status |
|---|---|---|
| D-30 | Teammate preview hosted on Vercel team `sillyguysolutions`, deployed from GitHub repo `Archiit-jain/SKILL-TO-HIRE-V2` (auto-deploy on push) | Chosen by user |
| D-31 | On Vercel the upload limit is 4 MB (platform body limit 4.5 MB), versus 5 MB locally | PENDING APPROVAL (forced by platform) |

## Hackathon release decisions (2026-09-15)

Owner answers: persistence on **Turso / libSQL**; new branch `feature/hackathon-release` from `security/remediation`;
commit and push the branch (no PR, no merge); a **tuned synthetic sample** run through the real engine for the demo.

| ID | Decision | Where |
|---|---|---|
| HR-1 | `@libsql/client` 0.18.0 for all storage. Hosted Turso when `TURSO_DATABASE_URL` is set; local file otherwise; `:memory:` in tests. Supersedes SEC-D1 (preview-only `/tmp`) and D-04 (`node:sqlite`) | `server/src/db.ts`, `config.ts` |
| HR-2 | Operations on one database are serialised per instance (the local driver can't run overlapping transactions); atomic sections use `db.transaction` | `db.ts` and callers |
| HR-3 | `schema_version` table instead of `PRAGMA user_version` (not guaranteed on hosted libSQL); legacy files are seeded from `user_version` | `db.ts` |
| HR-4 | Account deletion deletes child rows explicitly rather than relying on foreign-key enforcement of the connection | `routes/account.ts` |
| HR-5 | The banner depends on the server's real storage state (`persistentStorage`), not on being built by Vercel | `PreviewBanner.tsx` |
| HR-6 | Related-but-different skills never earn credit; they are shown as notes and in recommendations | `skills.ts` `RELATED` |
| HR-7 | Confidence is categorical (high/medium/low) with stated rules; no numeric confidence or accuracy figures are invented | `analyze.ts`, `requirements.ts` |
| HR-8 | A preferred experience/education/certification requirement uses the existing required 1 / preferred 0.5 weighting; the six base weights are unchanged | `analyze.ts`, `weights.ts` |
| HR-9 | If the JD accepts equivalent experience and no qualifying degree is found, Education is not scored (it can't be verified from a resume) rather than scored 0 or given invented partial credit | `analyze.ts` |
| HR-10 | Overall score is shown and stored as a whole number; component scores keep one decimal in the data; contributions are shown so the arithmetic can be followed | `analyze.ts`, `ResultsPage.tsx` |
| HR-11 | Recommendation impact = score points computed from this analysis's weights; Wording Similarity changes are excluded and the note says so | `recommendations.ts` |
| HR-12 | Roadmap is generated on the server, ordered by requirement group with prerequisite pull-forward; no dates or durations | `roadmap.ts` |
| HR-13 | Sample analysis: synthetic documents, fixed date 2026-03-01, computed per instance, never stored; its assistant is rules-only and shares the existing 60/h assistant IP limit (no new limit) | `demo.ts`, `routes/demo.ts` |
| HR-14 | Authenticated browser flows are verified by an API-level journey test rather than by typing credentials into the browser | `journey.test.ts` |
| HR-15 | Colours come from CSS variables mapped onto Tailwind's palettes, so light/dark is one class on `<html>`; `ink`/`parrot` stay fixed for surfaces that are dark in both themes | `src/index.css`, `tailwind.config.js` |
| HR-16 | Theme follows the system setting until the user picks one with the toggle (stored in localStorage, applied pre-paint by `public/theme-init.js`) | `src/lib/theme.ts` |
| HR-17 | Fonts are self-hosted through `@fontsource-variable` rather than Google Fonts, which the CSP would block and which would send visitor IPs to Google | `src/main.tsx` |
| HR-18 | Home-page motion is decorative and removed under `prefers-reduced-motion`; no motion elsewhere | `index.css`, `useReveal.ts` |
| HR-19 | Account-only navigation items look and behave like normal buttons and route guests to sign-in (no lock icons or disabled styling) | `Sidebar.tsx`, `App.tsx` |

## Security remediation decisions (approved by the owner, 2026-09-14)

Branch `security/remediation`. IDs are prefixed `SEC-` so they don't clash with the D-numbers above.

| ID | Decision | Priority | Where |
|---|---|---|---|
| SEC-D1 | V2 stays **preview-only** on Vercel with the per-instance `/tmp` SQLite; no hosted database yet (documentation in P1) | P1 | docs |
| SEC-D2 | DOCX caps: 20 MB declared archive total, 4 MB per XML/rels part, 4 MB all XML/rels, 2,000 entries (PROVISIONAL; peak memory measured and reported, see `SECURITY.md`) | P0 | `config.upload`, `analysis/docx-guard.ts` |
| SEC-D3 | PDF caps: Flate 10 MB per stream, 30 MB per document; reject encrypted PDFs, LZW, RunLength, ASCII85/ASCIIHex, unsupported and chained filters → `422 file_too_complex` | P0 | `config.upload`, `analysis/pdf-guard.ts` |
| SEC-D5 | At most 2 simultaneous document parses per instance → `503 server_busy`, `Retry-After: 5` (password-hash slots follow in P1) | P0 | `config.upload`, `analysis/parse-slots.ts` |
| SEC-R5 | Encrypted PDFs get the specific message "Encrypted or password-protected PDFs aren't supported. Please upload an unprotected PDF." | P0 | `analysis/pdf-guard.ts` |

### Security remediation P1 (approved by the owner, 2026-09-14)

| ID | Decision | Where |
|---|---|---|
| SEC-D1 | Preview-only on Vercel with per-instance `/tmp` SQLite; documented that data may reset and isn't shared across instances. No hosted database. | `SECURITY.md`, `SETUP.md` |
| SEC-D4 | Over-limit text/pages are rejected (`422 document_too_long`): resume > 100,000 characters, JD > 50,000, PDF > 20 pages (page count checked before text extraction). No silent truncation. Pasted JD over the limit moved from 400 to 422. | `analysis/extract.ts`, `routes/analyses.ts` |
| SEC-D5b | At most 2 concurrent scrypt operations; 5 s wait, then `503 server_busy` + `Retry-After: 5`. scrypt parameters unchanged. | `security/password-slots.ts` |
| SEC-D6 | Guest free-use marker kept 365 days, unclaimed guest results 30 days, claimed content deleted on transfer, account deletion is a hard delete; purged on normal guest requests. | `security/guest.ts`, migration 3 |
| SEC-D7 | Sessions table with a `jti` per session: logout revokes the current session, logout-all and password change revoke all, email change revokes others and reissues the current one, Google takeover revokes the account's sessions. | `security/session.ts`, `middleware/auth.ts`, migration 3 |
| SEC-D8 | 5 failed logins per account per 15 min (HMAC email key, identical for unknown emails), 60 assistant requests per user per hour; existing IP limits kept. | `security/fixed-window.ts`, `routes/auth.ts`, `routes/assistant.ts` |
| SEC-D9 | Gemini kept on for the preview: 20 answers/user and 500/global per UTC day reserved before the call (retry = same unit, rejected output still counts), silent rules fallback, mandatory contact-detail redaction, JSON payload with an untrusted-data instruction, output validation (STOP, ≤ 4,000 chars, no links, numbers, ratings, quotes), exact Assistant disclosure. | `assistant/*.ts`, `AssistantPage.tsx`, migration 3 |
| SEC-M8 | `NODE_ENV=production` and the Vercel production deployment refuse to start without `JWT_SECRET`. | `config.ts` |
| SEC-A1 | Architecture test: every prepared statement that reads, updates or deletes an owned table filters by its owner column (explicit allow-list for retention cleanup and token lookups). | `server/tests/ownership-queries.test.ts` |
| D-43 | ~~Email change keeps the current session~~ → changed by SEC-D7: other devices are signed out, the current session is reissued. | |
| D-44 | ~~Guest results kept until claimed~~ → changed by SEC-D6. | |

### Security remediation P2 and P3 (2026-09-15)

| ID | Decision | Where |
|---|---|---|
| SEC-D8b | Auth IP limiter split per route with the approved values: login 20/15 min, sign-up 5/h, verification + resend 10/15 min (shared), Google 20/15 min; profile/password/deletion keep the former 10/15 min; api 300/15 min, analysis 30/h, assistant 60/h unchanged | `middleware/security.ts` |
| SEC-D10 | Sign-up gives the same 201 for new and existing addresses; verified owners get a notice email, unverified ones their verification link (cooldown applies); existing accounts are never changed | `routes/auth.ts`, `email/mailer.ts` |
| SEC-D11 | 20 s parse deadline per upload request (the roadmap's D-11 value). Implemented as a **worker thread** that is terminated at the deadline, with `@napi-rs/canvas` replaced by an inert placeholder inside the worker (native addon + terminate crashed the process), and **one** worker per instance (two workers exceeded 1024 MB). In-process fallback with a reason code if the worker can't start | `analysis/document-parser.ts`, `analysis/parse-worker.ts`, `analysis/canvas-placeholder.cjs` |
| SEC-L4 | Production `/api/health` returns only `{status}` | `app.ts` |
| SEC-L5 | Logs carry reason codes/error classes only (no messages that could contain emails, document text or token details) | `app.ts`, `extract.ts`, `auth.ts`, `account.ts`, `google.ts`, `email-check.ts` |
| SEC-L6 | `npm run audit` (`--audit-level=high`) plus a GitHub Actions workflow running audit, typecheck, tests and build | `package.json`, `.github/workflows/security.yml` |
| SEC-CSP | `style-src` without `'unsafe-inline'`; Radix ScrollArea's style allowed by SHA-256 hash (server and vercel.json) | `middleware/security.ts`, `vercel.json` |
| SEC-P3 | RAG security guardrails written as a design document only; RAG is not implemented | `docs/RAG-SECURITY.md` |
