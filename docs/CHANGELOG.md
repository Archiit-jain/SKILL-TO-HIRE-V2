# Changelog

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
- `ResultsPage` — "% match" relabelled "% context" with a tooltip (it is wording overlap, not proficiency); shows
  components that weren't scored; empty states; missing skills show required vs preferred.
- `AssistantPage` — real API calls, safe bold rendering, form submit guarded while waiting, auto-scroll,
  starter prompt uses your actual partial skill.
- `RoadmapPage` — dead buttons wired; highest-impact items first.
- `ProgressPage` — real history from the API, with open and delete per entry.
- `SettingsPage` — removed the hard-coded `password123`; real profile update (password needed to change email),
  password change, persisted privacy/notification settings, account deletion with password confirmation.
- `HomePage` — accurate privacy copy.
- `types/index.ts` — `AnalysisResult.id`, `notAssessed`, `engineVersion`; `ProgressEntry.id`, `resumeName`; `UserSettings`.
