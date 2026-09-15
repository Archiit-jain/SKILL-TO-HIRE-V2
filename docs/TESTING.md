# Testing

## Automated

```bash
npm test
```

Runner: Node's built-in `node:test` via `tsx`, HTTP tests via `supertest`, in-memory SQLite, IP rate limits disabled
(`NODE_ENV=test`; the P1 per-account/per-user limits stay active and are tested with injected clocks). Gemini is
never called: tests inject fake phrasers and need no API key. Fixtures in `server/tests/fixtures.ts` are **synthetic** (not real people) and include a
generator for a minimal valid PDF.

**Result on 2026-09-15 (security remediation P1): 196 tests, 37 suites, 196 passed, 0 failed.** `npm run typecheck`, `npm run build` and `npm audit --audit-level=high` (0 vulnerabilities) also pass.

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
| migration 3 (`migration.test.ts`) | 5 | Fresh DB at v3 with exact schema, v2 file upgrade (markers backfilled before claimed rows deleted), runs once, failed migration rolls back, cascades and constraints |
| D-4 text/page limits (`text-limits.test.ts`, 2 suites) | 11 | Resume 100,000/100,001, pasted and file JD 50,000/50,001, no truncation, PDF 20/21 pages with the page count checked before text extraction |
| D-5 password slots (`password-slots.test.ts`) | 7 | Approved values and unchanged scrypt parameters, max 2 concurrent, arrival order, 5 s timeout → 503 + Retry-After, slot released on error, dummy hash covered, signup/login/password change/deletion busy responses, burst of logins |
| D-6 guest lifecycle (`guest-lifecycle.test.ts`) | 12 | Marker instead of guest_analyses, atomic marker gate and parallel requests, claim deletes content and keeps marker, 30-day results, 365-day markers, account deletion (H-2), pre-P1 leftovers |
| D-7 sessions (`sessions.test.ts`) | 9 | jti = session row, logout (replay, idempotent, other device), logout-all, password change, email change, Google takeover, unknown/foreign/expired/missing jti, token version, cascade and cleanup |
| D-8 rate limits (`rate-limits.test.ts`, 2 suites) | 8 | 5 failed logins/account/15 min incl. identical unknown-email response, reset on success, parallel guesses; 60 assistant requests/user/hour with window reset |
| D-9 Gemini (`gemini-guard.test.ts`, 4 suites) | 18 | Redaction regardless of privacy mode, no file name, JSON boundary, validation (STOP, length, links, numbers, ratings, quotes), 20/user and 500/global quotas, atomic concurrency, UTC rollover, retry counts once, fallback with reason-code-only logs, stored analysis unchanged, exact disclosure |
| M-8 JWT secret (`config-secret.test.ts`) | 4 | Vercel production and NODE_ENV=production refuse a missing secret; preview and tests keep working |
| ownership queries (`ownership-queries.test.ts`) | 5 | Every prepared statement on an owned table filters by its owner (TypeScript AST scan, literal SQL only, allow-list can't go stale, the rule catches IDOR-shaped queries) |
| upload safety (P0) (`api.test.ts`) | 6 | Approved SEC-D5 values; 503 `server_busy` + `Retry-After: 5` without using a guest's free analysis; slot released after rejections; DOCX and PDF bombs rejected for guests, users and as JD files with nothing stored; encrypted PDF message |

Other checks run:

| Check | Command | Result |
|---|---|---|
| Type-check (frontend + backend) | `npm run typecheck` | Pass |
| Production build | `npm run build` | Pass (JS 278 kB / 83 kB gzip) |
| Dependency audit | `npm audit` | 0 vulnerabilities |
| Production-mode smoke test | `NODE_ENV=production` server on a test port | `/` serves the built SPA, CSP + HSTS present, `/api/health` ok |

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
- Gemini mode (requires your API key and model choice).
- Accuracy against real resumes/JDs, and cross-browser/mobile layout.
