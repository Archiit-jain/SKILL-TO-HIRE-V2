# Testing

## Automated

```bash
npm test
```

Runner: Node's built-in `node:test` via `tsx`, HTTP tests via `supertest`, in-memory SQLite, rate limits disabled
(`NODE_ENV=test`). Fixtures in `server/tests/fixtures.ts` are **synthetic** (not real people) and include a
generator for a minimal valid PDF.

**Result on 2026-09-13: 37 tests, 9 suites, 37 passed, 0 failed (≈ 6 s).**

| Suite | Tests | Covers |
|---|---|---|
| skill matching | 3 | Aliases & punctuation names; no false positives on English words; Java ≠ JavaScript |
| sections and signals | 5 | Heading detection, section tagging, overlapping date ranges, years/degree parsing, job title |
| requirement extraction | 1 | Required vs preferred classification |
| analyze() | 5 | Strong/partial/missing, weighted score maths, determinism, privacy redaction, skipped components |
| assistant (rules mode) | 3 | Skill explanation, gap prioritisation, no-analysis response |
| file handling | 4 | PDF extraction, signature mismatch, zip bomb, filename/PII sanitising |
| auth | 6 | Signup/cookie flags, validation, generic login errors, CSRF, forged tokens, headers |
| account | 2 | Password change + session revocation; email change / settings / deletion |
| analyses | 8 | Auth required, PDF + pasted JD, TXT JD upload, spoofed/oversize/missing input, history, cross-user isolation, assistant, delete |

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

## Not yet tested

- DOCX upload through the browser (DOCX parsing is covered only by the zip-bomb precheck unit test, since no DOCX fixture exists).
- Gemini mode (requires your API key and model choice).
- Accuracy against real resumes/JDs, and cross-browser/mobile layout.
