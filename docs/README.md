# Skill2Hire AI Resume Analyzer — Documentation Index

| # | Document | Contents |
|---|---|---|
| 1 | [SETUP.md](SETUP.md) | Prerequisites, install, environment variables, dev and production runs, troubleshooting |
| 2 | [ARCHITECTURE.md](ARCHITECTURE.md) | System overview, folder structure, data flow, database schema |
| 3 | [API.md](API.md) | Every REST endpoint with request/response shapes and error codes |
| 4 | [SCORING.md](SCORING.md) | How resumes and JDs are parsed and how every score is calculated |
| 5 | [SECURITY.md](SECURITY.md) | Audit of the original frontend, patches applied, threat model, remaining risks |
| 6 | [TESTING.md](TESTING.md) | Automated test inventory and the manual end-to-end checks that were run |
| 7 | [DECISIONS.md](DECISIONS.md) | Decisions taken, and the **PENDING APPROVAL** / **OPEN DECISION** list |
| 8 | [CHANGELOG.md](CHANGELOG.md) | What was changed from the original frontend-only code |

## Project status (2026-09-15, hackathon release)

- Branch `feature/hackathon-release`: persistent storage on libSQL/Turso, analysis engine 2.0 (structured JD
  requirements, evidence with reasons and confidence, no false skill equivalence, score breakdown, prioritised
  recommendations, roadmap), a live synthetic sample analysis, and a responsive redesign of the main pages.
- Verified: 276/276 automated tests, type-check, production build, `npm audit` (0 vulnerabilities), a browser run of the
  guest journey at desktop, tablet and mobile widths, and an API-level journey test for the signed-in flow.
- Not verified: a real Turso database (no credentials), Gemini against the real API, accuracy on real resumes.

## Project status (2026-09-13)

- Original input: a React/TypeScript frontend (`src/`) with no build config, no UI component files and only
  simulated data (fake login, a hard-coded analysis result, canned chat replies, hard-coded progress).
- Now: runnable full-stack app with a real backend, database, authentication, file parsing, analysis engine,
  assistant, history and account management.
- Verified: 37/37 automated tests pass, both TypeScript projects type-check, the production build succeeds,
  `npm audit` reports 0 vulnerabilities, and the full flow was exercised in a browser (sign up → upload PDF →
  results → assistant → progress).
- Not done: real-world accuracy evaluation of the scoring (no labelled resume/JD dataset was used), email delivery
  for notifications, deployment. See [DECISIONS.md](DECISIONS.md).
