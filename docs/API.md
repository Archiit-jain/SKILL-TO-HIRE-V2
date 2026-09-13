# API Reference

Base path: `/api`. All responses are JSON and carry `Cache-Control: no-store`.

**Conventions**
- Authentication: the `s2h_session` httpOnly cookie, set by signup/login.
- CSRF: every `POST`/`PUT`/`PATCH`/`DELETE` must send `X-Requested-With: skill2hire`. If an `Origin` header is
  present it must match `APP_ORIGIN` or the request's own host.
- Errors: `{"error": {"code": "<code>", "message": "<human readable>"}}`

| Status | code | When |
|---|---|---|
| 400 | `validation`, `bad_request`, `upload` | Invalid body/params, malformed JSON, bad multipart |
| 401 | `unauthenticated`, `invalid_credentials` | No or invalid session; wrong login |
| 403 | `csrf`, `invalid_password` | CSRF check failed; current password wrong |
| 404 | `not_found` | Unknown route, or an analysis that isn't yours |
| 409 | `email_taken` | Email already registered |
| 413 | `upload` | File larger than 5 MB |
| 415 | `file_type` | Extension not allowed, or content doesn't match extension |
| 422 | `file_corrupt`, `file_too_complex`, `empty_text` | Unreadable file, zip bomb, too little text |
| 429 | `rate_limited` | Rate limit exceeded |
| 500 | `internal` | Unexpected error (details only in the server log) |

---

## Health

`GET /api/health` → `200 {"status":"ok","assistant":"rules"|"gemini"}`

## Auth

### `POST /api/auth/signup` (rate limited: auth)
Body `{name, email, password}`. Name is 1–80 chars without `<>` or control chars; email is valid and max 254 chars
(stored lowercase); password is 8–128 chars.
→ `201 {"user":{"name","email"}}` + session cookie. `409` if the email exists.

### `POST /api/auth/login` (rate limited: auth)
Body `{email, password}` → `200 {"user":{...}}` + cookie. `401` with the same message whether the email or the password is wrong.

### `POST /api/auth/logout`
Clears the cookie → `204`.

### `POST /api/auth/logout-all` (auth)
Increments the token version so every session for the account is revoked → `204`.

### `GET /api/auth/me` (auth)
→ `200 {"user":{"name","email"}}` or `401`.

## Account (all require auth)

| Method & path | Body | Response |
|---|---|---|
| `GET /api/account/settings` | — | `{privacyMode, notifications}` |
| `PUT /api/account/settings` | `{privacyMode: bool, notifications: bool}` | same object |
| `PATCH /api/account` | `{name, email, currentPassword?}`. `currentPassword` is required if the email changes | `{user}` |
| `PUT /api/account/password` | `{currentPassword, newPassword}` | `204`; other sessions revoked, current cookie re-issued |
| `DELETE /api/account` | `{currentPassword}` | `204`; user and all analyses deleted, cookie cleared |

`PATCH`, `PUT /password` and `DELETE` share the auth rate limit.

## Analyses (all require auth)

### `POST /api/analyses` (rate limited: analysis)
`multipart/form-data`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `resume` | file | yes | `.pdf` or `.docx`, ≤ 5 MB |
| `jdText` | text | one of `jdText` / `jdFile` | ≤ 50,000 chars; takes precedence over `jdFile` |
| `jdFile` | file | one of `jdText` / `jdFile` | `.pdf`, `.docx` or `.txt`, ≤ 5 MB |
| `jdTitle` | text | no | ≤ 120 chars; guessed from the JD if empty |

→ `201 {"result": AnalysisResult}`

```jsonc
{
  "id": "uuid",
  "overallScore": 63.0,
  "components": [{"name":"Skill Match","score":71.4,"weight":0.35,"description":"..."}],
  "notAssessed": ["Certifications - the job description does not mention certifications"],
  "strongSkills":  [{"skill":"Python","status":"strong","requirementType":"required","evidence":"...","similarityScore":12,"section":"Experience","importanceWeight":1}],
  "partialSkills": [...],
  "missingSkills": [{"skill":"Kubernetes","status":"missing","requirementType":"required","importanceWeight":1}],
  "whyNotMe": {"strengths":[], "gaps":[], "weakSupport":[], "improvements":[]},
  "resumeName": "resume.pdf",
  "jdTitle": "Data Engineer",
  "analyzedAt": "2026-09-13T08:50:52.000Z",
  "engineVersion": "rules-tfidf-1.0"
}
```

### `GET /api/analyses`
Newest first, max 100 → `{"analyses":[{id, date, score, jdTitle, resumeName, strongCount, partialCount, missingCount}]}`

### `GET /api/analyses/latest`
→ `{"result": AnalysisResult | null}`

### `GET /api/analyses/:id` · `DELETE /api/analyses/:id`
`:id` must be a UUID (`400` otherwise). Queries always filter by the current user, so another user's id returns `404`.
GET → `{"result": AnalysisResult}`; DELETE → `204`.

## Assistant (requires auth)

### `GET /api/assistant/status`
→ `{"mode":"rules"|"gemini"}`

### `POST /api/assistant/chat` (rate limited: assistant)
Body `{question: string (1–1000), analysisId?: uuid}`. Without `analysisId` the latest analysis is used.
→ `200 {"content": string, "sources": string[], "mode": "rules"|"gemini"}`. `404` if `analysisId` isn't yours.

## Rate limits (per client IP)

| Limiter | Window | Max requests | Applies to |
|---|---|---|---|
| api | 15 min | 300 | every `/api` request |
| auth | 15 min | 10 | signup, login, profile/password/account-delete |
| analysis | 60 min | 30 | `POST /api/analyses` |
| assistant | 60 min | 60 | `POST /api/assistant/chat` |

These values are provisional; see [DECISIONS.md](DECISIONS.md). Limits are disabled when `NODE_ENV=test`.
