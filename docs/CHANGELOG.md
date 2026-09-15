# Changelog

## Unreleased — hackathon release (branch `feature/hackathon-release`)

### Persistence
- One async data layer on `@libsql/client`: hosted Turso database (`TURSO_DATABASE_URL`, `TURSO_AUTH_TOKEN`), local
  SQLite file in development, in-memory databases in tests. Replaces `node:sqlite` and the per-instance `/tmp`
  database as the production path; `/tmp` remains only as a flagged fallback.
- Atomic sections run in write transactions; `schema_version` table (existing databases seeded from `user_version`).
- Account deletion removes child rows explicitly. `persistentStorage` in `/api/auth/providers` and dev `/api/health`.

### Analysis engine 2.0 (`rules-tfidf-2.0`)
- Structured JD requirements with source sentence, required/preferred reason and confidence; benefits sections ignored.
- False equivalences removed from the taxonomy (GitHub, version control, containerization, JWT, Unix, bare Lambda);
  related skills shown but never counted.
- Per-skill reason, JD evidence, confidence (low for ambiguous English words) and related evidence.
- "Semantic Similarity" renamed "Wording Similarity"; component contributions; whole-number overall score;
  `similarityScore` ("% context") removed.
- Education equivalence and in-progress degrees, preferred experience/education/certification weighting, courses
  not counted as certifications, missing dates flagged.
- Overall confidence with reasons; prioritised recommendations with impact from the scoring weights; server-side
  roadmap with prerequisites and no dates. Rules assistant answers with this evidence; engine 1.0 results still work.

### Sample analysis
- `GET /api/demo/analysis` and rules-only `POST /api/demo/assistant` on synthetic documents, computed live.

### Frontend
- Homepage: accurate headline, live sample preview, specific "How it works", **Try Demo Analysis**, honest limits and
  data-use copy.
- New Analysis: readiness checklist, JD character counter and minimum, accurate limits, elapsed-time loading state.
- Results: score with required-skill coverage and confidence, critical gaps, "How your score was calculated" table,
  filterable skills with evidence, structured "Why not me?", JD requirements panel; "% context" removed.
- Roadmap grouped by priority with prerequisites and learn → build → demonstrate → document → re-analyze steps,
  strong skills collapsed. Progress grouped by role with change since the first analysis.
- Responsive shell: sidebar on desktop, collapsible icon rail on tablets, top bar and drawer on mobile.
- Banner shown only when the server reports temporary storage. Auth and Settings privacy copy corrected (the
  Gemini data flow is disclosed); dead "resend" button for a removed error code deleted.

## Unreleased — security remediation P2 and P3 (branch `security/remediation`)

### Security
- **Parse deadline (D-11):** 20 s per upload request; documents are parsed in a worker thread that is terminated at the
  deadline (422 `file_too_complex`), with the parse slot held until the thread exits. The native canvas addon is
  replaced by a placeholder in the worker (terminating a worker that loaded it crashed the process), and one worker is
  used per instance (two exceeded the 1024 MB Vercel function). Falls back to in-process parsing with a reason code.
- **Rate limits (D-8):** the shared auth limiter is split into login, sign-up, verification and Google limiters with
  the approved values; the limiters are now testable and tested.
- **Sign-up enumeration (D-10):** identical 201 for new and existing addresses; existing verified owners get a notice email.
- **CSP:** `style-src` without `'unsafe-inline'` (Radix ScrollArea style allowed by hash), verified in a browser.
- **Health (L-4):** production `/api/health` returns only `{status}`.
- **Logs (L-5):** error classes and reason codes instead of messages that could contain emails, content or token details.
- **Dependency audit (L-6):** `npm run audit` and a GitHub Actions workflow (audit, typecheck, tests, build).
- **P3:** `docs/RAG-SECURITY.md` design guardrails for a future RAG feature (not implemented).

## Unreleased — security remediation P1 (branch `security/remediation`)

### Security
- **Migration 3:** `guest_free_use`, `sessions`, `assistant_usage`, `assistant_usage_global`; claimed guest rows deleted.
- **D-4:** resume text over 100,000 characters, JD text over 50,000 and PDFs over 20 pages are rejected with
  `422 document_too_long` instead of being silently truncated or partly read.
- **D-5:** at most 2 concurrent scrypt operations; 5 s wait, then `503 server_busy`.
- **D-6:** guest free-use marker (365 days), 30-day guest results, claim deletes guest content (fixes H-2).
- **D-7:** database-backed sessions with a `jti`; logout revokes the copied token immediately (fixes M-1); email
  change signs out other devices (L-1).
- **D-8:** 5 failed logins per account per 15 min; 60 assistant requests per user per hour.
- **D-9:** Gemini quotas (20/user, 500/global per UTC day), mandatory contact-detail redaction, JSON payload with an
  untrusted-data instruction, output validation with rules fallback, reason-code-only logging, Assistant disclosure.
- **M-8:** the Vercel production deployment refuses to start without `JWT_SECRET`.
- Login runs a real scrypt comparison for Google-only accounts too, so they can't be told apart by timing.
- Architecture test for owner-scoped SQL.
- **Deploy note:** every user logs in once after deployment (old tokens have no `jti`); set `JWT_SECRET` for Vercel
  production before merging to `main`.

## Unreleased — security remediation P0 (branch `security/remediation`)

### Security
- **DOCX guard** before mammoth: ZIP structure checks, 20 MB declared total, relationship-aware 4 MB XML caps, real
  size + CRC-32 verification of every XML part, DTD/ENTITY rejection. Fixes the audit's C-1 (129 KB DOCX → 3.46 GB)
  and H-1 (declared-size lie inflated to 400 MB before rejection).
- **PDF pre-scan** before pdf.js: encrypted PDFs and unsupported/chained filters rejected; Flate streams counted in
  64 KB chunks against 10 MB per stream / 30 MB total without trusting `/Length` or `endstream`. Fixes C-2 (285 KB PDF
  with a 300 MB stream accepted, 1.15 GB).
- **Parse slots**: at most 2 documents parsed at once per instance; otherwise `503 server_busy` + `Retry-After: 5`.
- `HttpError` can carry response headers (used for `Retry-After`).
- Tests: 55 → 117 (DOCX guard 25, PDF guard 31, upload safety API 6); the zip-bomb unit test now uses the new guard.

## 1.1.0 — 2026-09-13 — Guest analysis, Google sign-in, email verification, Vercel

### Added
- **One free analysis without an account** (per browser); a second attempt opens the login screen. The guest result
  is moved into the account on sign-in. Guests can use Home, New Analysis, Results and Roadmap; Assistant, Progress
  and Settings are locked.
- **Sign in with Google** (Google Identity Services popup; server verifies the ID token).
- **Email verification**: sign-up sends a single-use link; login is blocked until verified; resend with cooldown;
  email changes are re-verified.
- **Fake-email blocking**: disposable/temp-mail domains and domains without a mail server are rejected.
- Gmail SMTP mailer (dev prints links to the console), `GET /api/auth/providers`, DB migrations via `PRAGMA user_version`.
- Google-only accounts can set a password and delete their account with a typed confirmation.
- Vercel deployment: `api/index.ts`, `vercel.json`, preview banner, 4 MB upload limit on Vercel.
- Tests: 38 → 54 (verification, disposable/DNS rejection, resend enumeration & cooldown, Google sign-in incl.
  pre-registration takeover, guest limit & claim, source hygiene).

### Fixed
- Vercel function crashed on start (pdf.js needed `@napi-rs/canvas`, not traced by the bundler) and then couldn't
  parse PDFs (worker file not bundled): canvas polyfill imported statically, embedded worker, PDF library loaded lazily.
- Raw control characters in several regex literals replaced with `\uXXXX` escapes; a test now guards against it.
- Empty values in `.env` (e.g. `JWT_SECRET=`) are treated as unset instead of failing validation.


## 1.0.0 — 2026-09-13 — Made runnable, backend added, security patched

### Added
- Project scaffolding: `package.json` (pinned deps + scripts), `index.html`, `src/main.tsx`, `src/index.css`,
  `vite.config.ts` (with `@` alias and `/api` proxy), Tailwind/PostCSS config, `tsconfig.json`, `.env.example`, `.gitignore`.
- Missing UI primitives `src/components/ui/{button,card,input,label,textarea,badge,progress,switch,scroll-area}.tsx`
  and `src/lib/utils.ts`, which the original imports referenced but didn't include.
- `src/lib/api.ts` typed API client.
- Backend `server/`: Express 5 app, SQLite schema, auth/account/analyses/assistant routes, PDF/DOCX/TXT extraction,
  deterministic analysis engine, rule-based assistant with optional Gemini phrasing, security middleware.
- 37 automated tests; `docs/` folder.

### Changed (frontend)
- `useAuth` — real login/signup/logout against the API, with session restore on load.
- `App.tsx` — loading state, loads the latest saved analysis after login, empty state for Results, opens
  analyses from history.
- `AuthPage` — async submit with error display and loading state, autocomplete/maxLength attributes, accurate privacy copy.
- `AnalysisPage` — replaced the hard-coded 2-second fake result with a real upload; added optional Job Title,
  extension checks, inline errors; accurate data-handling copy.
- `ResultsPage` — (superseded in the hackathon release: the "% context" badge was removed) "% match" relabelled "% context" with a tooltip (it is wording overlap, not proficiency); shows
  components that weren't scored; empty states; missing skills show required vs preferred.
- `AssistantPage` — real API calls, safe bold rendering, form submit guarded while waiting, auto-scroll,
  starter prompt uses your actual partial skill.
- `RoadmapPage` — dead buttons wired; highest-impact items first.
- `ProgressPage` — real history from the API, with open and delete per entry.
- `SettingsPage` — removed the hard-coded `password123`; real profile update (password needed to change email),
  password change, persisted privacy/notification settings, account deletion with password confirmation.
- `HomePage` — accurate privacy copy.
- `types/index.ts` — `AnalysisResult.id`, `notAssessed`, `engineVersion`; `ProgressEntry.id`, `resumeName`; `UserSettings`.
