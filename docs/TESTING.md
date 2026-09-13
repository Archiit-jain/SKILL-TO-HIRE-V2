# Testing

## Automated

```bash
npm test
```

Runner: Node's built-in `node:test` via `tsx`, HTTP tests via `supertest`, in-memory SQLite, rate limits disabled
(`NODE_ENV=test`). Fixtures in `server/tests/fixtures.ts` are **synthetic** (not real people) and include a
generator for a minimal valid PDF.

**Result on 2026-09-13 (v1.1): 54 tests, 13 suites, 54 passed, 0 failed.**

| Suite | Tests | Covers |
|---|---|---|
| skill matching | 3 | Aliases & punctuation names; no false positives on English words; Java ≠ JavaScript |
| sections and signals | 5 | Heading detection, section tagging, overlapping date ranges, years/degree parsing, job title |
| requirement extraction | 1 | Required vs preferred classification |
| analyze() | 5 | Strong/partial/missing, weighted score maths, determinism, privacy redaction, skipped components |
| assistant (rules mode) | 3 | Skill explanation, gap prioritisation, no-analysis response |
| file handling | 4 | PDF extraction, signature mismatch, zip bomb, filename/PII sanitising |
| source hygiene | 1 | No raw control characters in source files |
| auth: sign-up and email verification | 9 | No session before verification, link uses APP_ORIGIN, login blocked until verified, single-use & expiring tokens, disposable and no-MX domains rejected, resend doesn't reveal accounts, resend cooldown, sign-up disabled without mail delivery |
| auth: login and session security | 4 | Generic login errors, CSRF header/origin, forged tokens, security headers incl. Google CSP/COOP |
| auth: Google sign-in | 6 | Password-less verified account, invalid/unverified tokens rejected, "!" marker never works as a password, linking to a verified account, pre-registration takeover defence, set first password & DELETE confirmation |
| account | 3 | Password change revokes other sessions; email change needs password, blocks disposable, requires re-verification; settings & deletion |
| guest analysis | 3 | Exactly one analysis per browser, locked routes, guest result claimed on sign-up and free use stays consumed after logout |
| analyses (signed in) | 7 | PDF + pasted JD, TXT JD, spoofed/oversize/missing input, history, cross-user isolation, assistant, delete |

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

- DOCX upload through the browser (DOCX parsing is covered only by the zip-bomb precheck unit test, since no DOCX fixture exists).
- Gemini mode (requires your API key and model choice).
- Accuracy against real resumes/JDs, and cross-browser/mobile layout.
