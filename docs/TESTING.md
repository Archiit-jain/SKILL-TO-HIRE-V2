# Testing

## Automated

```bash
npm test
```

Runner: Node's built-in `node:test` via `tsx`, HTTP tests via `supertest`, in-memory libSQL databases (temporary SQLite
files for migration and persistence tests; Turso is never contacted), IP rate limits disabled
(`NODE_ENV=test`; the P1 per-account/per-user limits stay active and are tested with injected clocks). Gemini is
never called: tests inject fake phrasers and need no API key. Fixtures in `server/tests/fixtures.ts` are **synthetic** (not real people) and include a
generator for a minimal valid PDF.

**Result on 2026-09-15 (hackathon release, branch `feature/hackathon-release`): 276 tests, 58 suites, 276 passed, 0 failed.** `npm run typecheck`, `npm run build` and `npm run audit` (0 vulnerabilities) also pass.

| Suite | Tests | Covers |
|---|---|---|
| skill matching | 3 | Aliases & punctuation names; no false positives on English words; Java ≠ JavaScript |
| sections and signals | 5 | Heading detection, section tagging, overlapping date ranges, years/degree parsing, job title |
| requirement extraction | 1 | Required vs preferred classification |
| analyze() | 5 | Strong/partial/missing, weighted score maths, determinism, privacy redaction, skipped components |
| assistant (rules mode) | 3 | Skill explanation, gap prioritisation, no-analysis response |
| file handling | 4 | PDF extraction, signature mismatch, zip bomb (declared archive total over 20 MB), filename/PII sanitising |
| source hygiene | 1 | No raw control characters in source files |
| auth: sign-up and email verification | 9 | No session before verification, link uses APP_ORIGIN, login blocked until verified, single-use & expiring tokens, disposable and no-MX domains rejected, resend doesn't reveal accounts, resend cooldown, sign-up disabled without mail delivery |
| auth: login and session security | 4 | Generic login errors, CSRF header/origin, forged tokens, security headers incl. Google CSP/COOP |
| auth: Google sign-in | 6 | Password-less verified account, invalid/unverified tokens rejected, "!" marker never works as a password, linking to a verified account, pre-registration takeover defence, set first password & DELETE confirmation |
| account | 3 | Password change revokes other sessions; email change needs password, blocks disposable, requires re-verification; settings & deletion |
| guest analysis | 3 | Exactly one analysis per browser, locked routes, guest result claimed on sign-up and free use stays consumed after logout |
| analyses (signed in) | 7 | PDF + pasted JD, TXT JD, spoofed/oversize/missing input, history, cross-user isolation, assistant, delete |
| DOCX guard (`docx-guard.test.ts`, 4 suites) | 25 | Approved caps; valid DOCX still extracts; XML part/total/archive/entry caps incl. exact-cap acceptance; the audit's C-1 shape rejected before mammoth; size lies (H-1), CRC and stored-size mismatches; ZIP64, split, encrypted, bzip2/lzma, duplicate names, Unicode Path field; relationship-aware XML caps (renamed, absolute and image-typed targets); DOCTYPE/ENTITY in UTF-8/UTF-16LE/BE; malformed archives → `file_corrupt` |
| PDF guard (`pdf-guard.test.ts`, 5 suites) | 31 | Approved caps; normal and Flate PDFs still extract; exact-cap acceptance; image codecs; inline images (R-3); per-stream and total caps; the audit's C-2 shape rejected before pdf.js; fake `endstream`, short/indirect `/Length`, escaped names; encrypted PDFs incl. escaped `/Encrypt`; every rejected filter; corrupt Flate; malformed PDFs; linear time on hostile token soup |
| migrations and data layer (`migration.test.ts`, 2 suites) | 10 | Fresh DB at v3 with exact schema, v2 file upgrade (markers backfilled before claimed rows deleted), upgrade of a database created before `schema_version` (version read from `PRAGMA user_version`), runs once, failed migration rolls back, cascades and constraints; statement splitting, transaction rollback, 25 concurrent transactions without lost updates, plain rows with numeric integers |
| persistence (`persistence.test.ts`, 2 suites) | 7 | Database selection (Turso URL wins, Vercel `/tmp` fallback flagged ephemeral, tests always in-memory, malformed URL rejected); accounts and analyses survive a server restart on a file database; `persistentStorage` flag; account deletion removes every owned row with foreign keys switched off |
| engine 2.0 (`intelligence.test.ts`, 8 suites) | 38 | No false equivalence (Docker/Kubernetes, Git/GitHub, React/JavaScript, PostgreSQL/SQL both ways, C/C++, OAuth/JWT) with related notes; true aliases kept; JD decomposition (sentence, type reason, confidence, benefits ignored, inline headings, degree equivalence); reasons and confidence incl. ambiguous words; Wording Similarity naming, contributions and whole-number score, unchanged weights; equivalent-experience education, in-progress degree, course ≠ certification, missing dates; recommendation order, fields and impact maths; roadmap order, prerequisites moved earlier, no timelines; assistant with evidence and engine 1.0 fallback; sample is real engine output, deterministic, synthetic |
| sample analysis (`demo.test.ts`, 2 suites) | 5 | Sample stores nothing and sets no cookie; guest free analysis still available; sample assistant is rules-only (fake Gemini never called, no quota), validated, CSRF-protected and shares the 60/h assistant IP limit |
| user journey (`journey.test.ts`) | 1 | Sample → guest analysis → second guest analysis blocked → sign-up + verification → guest result claimed → improved resume re-analysed (score and Kubernetes rating move) → progress history → assistant with evidence → second device sees the data → delete analysis → delete account, nothing left |
| D-4 text/page limits (`text-limits.test.ts`, 2 suites) | 11 | Resume 100,000/100,001, pasted and file JD 50,000/50,001, no truncation, PDF 20/21 pages with the page count checked before text extraction |
| D-5 password slots (`password-slots.test.ts`) | 7 | Approved values and unchanged scrypt parameters, max 2 concurrent, arrival order, 5 s timeout → 503 + Retry-After, slot released on error, dummy hash covered, signup/login/password change/deletion busy responses, burst of logins |
| D-6 guest lifecycle (`guest-lifecycle.test.ts`) | 12 | Marker instead of guest_analyses, atomic marker gate and parallel requests, claim deletes content and keeps marker, 30-day results, 365-day markers, account deletion (H-2), pre-P1 leftovers |
| D-7 sessions (`sessions.test.ts`) | 9 | jti = session row, logout (replay, idempotent, other device), logout-all, password change, email change, Google takeover, unknown/foreign/expired/missing jti, token version, cascade and cleanup |
| D-8 rate limits (`rate-limits.test.ts`, 2 suites) | 8 | 5 failed logins/account/15 min incl. identical unknown-email response, reset on success, parallel guesses; 60 assistant requests/user/hour with window reset |
| D-9 Gemini (`gemini-guard.test.ts`, 4 suites) | 18 | Redaction regardless of privacy mode, no file name, JSON boundary, validation (STOP, length, links, numbers, ratings, quotes), 20/user and 500/global quotas, atomic concurrency, UTC rollover, retry counts once, fallback with reason-code-only logs, stored analysis unchanged, exact disclosure |
| M-8 JWT secret (`config-secret.test.ts`) | 4 | Vercel production and NODE_ENV=production refuse a missing secret; preview and tests keep working |
| ownership queries (`ownership-queries.test.ts`) | 5 | Every `db`/`tx` `get`/`all`/`run` statement on an owned table filters by its owner (TypeScript AST scan, literal SQL only, allow-list can't go stale, the rule catches IDOR-shaped queries) |
| D-11 parse deadline (`parse-deadline.test.ts`, 2 suites) | 7 | 20 s deadline and one worker; normal PDF/DOCX parsed in the worker (which refuses to start if the native canvas addon loaded); a slow PDF stopped at its deadline and the worker exits, then a fresh worker works; queue time counts; in-process fallback with reason code; route answers 422, releases the slot after the worker exits, doesn't use the guest's free analysis; one deadline for resume + JD file |
| P2 hardening (`p2-hardening.test.ts`, 5 suites) | 17 | Split IP limits (login 20, sign-up 5, verification 10 shared, Google 20, analysis 30), spoofed X-Forwarded-For ignored, limiters off by default in tests; identical sign-up responses for new/unverified/verified addresses without changing accounts; notice email has no action link; production `/api/health` is `{status}` only; CSP hash equals the installed Radix style and vercel.json matches, no `unsafe-inline`; logs contain no mail messages, emails or document text |
| upload safety (P0) (`api.test.ts`) | 6 | Approved SEC-D5 values; 503 `server_busy` + `Retry-After: 5` without using a guest's free analysis; slot released after rejections; DOCX and PDF bombs rejected for guests, users and as JD files with nothing stored; encrypted PDF message |

Other checks run:

| Check | Command | Result |
|---|---|---|
| Type-check (frontend + backend) | `npm run typecheck` | Pass |
| Production build | `npm run build` | Pass (JS 638 kB / 163 kB gzip; Vite warns about the 500 kB chunk size) |
| Dependency audit | `npm run audit` (`npm audit --audit-level=high`, also in CI) | 0 vulnerabilities |
| CI | `.github/workflows/security.yml` | Runs `npm ci`, audit, typecheck, tests and a production build on every push and pull request |
| CSP in a real browser (P2) | Production build on a local port, logged in, Career Assistant with messages | Radix ScrollArea style applied, no CSP violations, no `unsafe-inline` |
| Production-mode smoke test | `NODE_ENV=production` server on a test port | `/` serves the built SPA, CSP + HSTS present, `/api/health` ok |

## Manual end-to-end (browser) — hackathon release, 2026-09-15

Run in the in-app browser against an isolated local server: a scratch env file with **no Gemini key** and a temporary
database outside the repo (the developer `.env` was not loaded, so no data went to Google).

1. Home (guest): accurate headline, live sample preview (score 53, Docker/AWS/Git examples, first step Airflow ≈ +5 pts).
2. **Try Demo Analysis** → Results with the "Sample" badge, critical gaps, score breakdown (points add up to 52.7,
   shown as 53), skill filters, structured recommendations, JD requirements panel.
3. Career Assistant from the sample, as a guest → `POST /api/demo/assistant` 200; the AWS answer quotes the reason,
   JD sentence, resume evidence and next step.
4. New Analysis: readiness checklist; a 35-character JD shows "At least 50 characters needed" and keeps the button
   disabled; with a synthetic PDF (built in the page and attached to the file input) and a full JD → 201, score 56,
   Kubernetes Missing with Docker as related, Education and Certifications "Not scored".
5. Roadmap for that analysis: "Required skills to add", "Preferred skills to add".
6. Responsive: 1280 px full sidebar (toggle hidden); 768 px 64 px icon rail that expands to 256 px and back; 375 px top
   bar with a drawer that closes on navigation; no horizontal overflow at any width, including the Results page on mobile.
7. Sign-up, verification, progress history and account deletion were **not** driven through the browser, because that
   means typing a password into a form. They are covered end to end by `journey.test.ts` through the HTTP API.

Vercel preview of the persistence commit (`9df50bc`, no Turso credentials): `GET /api/auth/providers` →
`{"googleClientId":null,"emailSignup":false,"persistentStorage":false}`. The libSQL native module loads and migrations
run on the `/tmp` fallback, and the API reports that storage is not persistent. A real Turso database was not available.

## Manual end-to-end (browser) — performed 2026-09-13

1. Opened http://localhost:5173 → the login screen appears (the `GET /auth/me` 401 is expected).
2. Sign Up with a test account → `201`, the Home page loads.
3. New Analysis → attached a synthetic PDF resume, pasted a Data Engineer JD → `201`, Results page shows
   **63.0/100**, six components, 5 strong / 1 partial / 2 missing.
4. Career Assistant → "Why is my Docker skill only Partial?" → the rule-based answer cites the Skills section evidence
   with sources.
5. Progress → the history entry is loaded from the database, and the filename shows as `resume.pdf` (privacy mode).

## Manual end-to-end (browser) — v1.1, 2026-09-13

Run against an isolated local server (separate ports and database):
1. Opened the app logged out → guest home with "Try a Free Analysis"; Assistant/Progress/Settings show a lock.
2. Ran a guest analysis (PDF + pasted JD) → results with a "Save this result" prompt.
3. Tried a second analysis → login screen: "You've used your free analysis…".
4. Sign-up with `…@mailinator.com` → "Temporary or disposable email addresses aren't allowed".
5. Sign-up with a non-existent domain → "The domain … can't receive email" (live DNS check).
6. Sign-up with a real domain → "Verify your email" screen; the link was taken from the dev console mailer.
7. Opened the link → "Email verified - you're signed in", `?verify=` removed from the URL; Progress shows the guest analysis.
8. With a placeholder `GOOGLE_CLIENT_ID` the official "Sign in with Google" button renders. A real Google login was
   **not** tested (no OAuth client ID yet), and no real email was sent (no SMTP credentials yet).

On Vercel (production URL): health check OK, sign-up + PDF analysis OK (before the v1.1 features were deployed).

## Not yet tested

- DOCX upload through the browser (DOCX parsing is covered by synthetic DOCX fixtures in `docx-guard.test.ts`).
- Peak memory and parse behaviour on Vercel itself (P0 measurements were taken locally, see `SECURITY.md`).
- Gemini mode against the real API (tests use fakes; the key in the developer `.env` was deliberately not used).
- A hosted Turso database (no credentials were available; see SETUP.md for the steps).
- Accuracy against real resumes/JDs; browsers other than the in-app Chromium.
