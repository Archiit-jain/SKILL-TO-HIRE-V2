# API Reference

Base path: `/api`. All responses are JSON and carry `Cache-Control: no-store`.

**Conventions**
- Authentication: the `s2h_session` httpOnly cookie, set by login, email verification and Google sign-in. Its JWT
  carries a `jti` that must match a live server-side session row (security remediation P1, D-7).
- CSRF: every `POST`/`PUT`/`PATCH`/`DELETE` must send `X-Requested-With: skill2hire`. If an `Origin` header is
  present it must match `APP_ORIGIN` or the request's own host.
- Errors: `{"error": {"code": "<code>", "message": "<human readable>"}}`

| Status | code | When |
|---|---|---|
| 400 | `validation`, `bad_request`, `upload`, `invalid_token`, `password_required`, `confirmation_required` | Invalid input; bad/expired verification link; Google-only account needs a password first; missing DELETE confirmation |
| 401 | `unauthenticated`, `invalid_credentials`, `login_required`, `google_invalid` | No/invalid session; wrong login; guest already used the free analysis; Google token rejected |
| 403 | `csrf`, `invalid_password`, `email_not_verified`, `google_email_unverified` | CSRF check failed; current password wrong; email not verified yet; Google email unverified |
| 404 | `not_found` | Unknown route, or an analysis that isn't yours |
| 409 | `email_taken`, `email_unverified_exists` | Email already registered (verified / waiting for verification) |
| 413 | `upload` | File larger than the upload limit (5 MB locally, 4 MB on Vercel) |
| 415 | `file_type` | Extension not allowed, or content doesn't match extension |
| 422 | `file_corrupt`, `file_too_complex`, `empty_text`, `disposable_email`, `email_domain_invalid` | Unreadable file; document over a safety limit (`"This document is too large or complex to process safely."`) or an encrypted PDF (`"Encrypted or password-protected PDFs aren't supported. Please upload an unprotected PDF."`); too little text; temporary-mail provider; domain can't receive email |
| 429 | `rate_limited` | Rate limit exceeded (IP limits; 5 failed logins per account per 15 min; 60 assistant requests per user per hour). Per-account and per-user limits add `Retry-After`. The response is identical for known and unknown emails |
| 500 | `internal` | Unexpected error (details only in the server log) |
| 502 | `email_send_failed` | Account created but the verification email couldn't be sent |
| 503 | `email_unavailable`, `google_unavailable`, `server_busy` | Email delivery / Google sign-in not configured on this server; all document parse slots on this instance are busy, or no password-hash slot freed up within 5 s (`"The server is busy. Please try again in a few seconds."`). Both carry `Retry-After: 5` |

---

## Health

`GET /api/health` → `200 {"status":"ok","assistant":"rules"|"gemini"}`

## Auth

### `GET /api/auth/providers`
→ `{"googleClientId": string|null, "emailSignup": boolean}`. Tells the UI whether to show the Google button and
whether email sign-up is possible (false in production without SMTP).

### `POST /api/auth/signup` (rate limited: auth)
Body `{name, email, password}`. Name is 1–80 chars without `<>` or control chars; email is valid and max 254 chars
(stored lowercase); password is 8–128 chars. The email must not be a disposable/temporary-mail domain, and (unless
`EMAIL_DNS_CHECK=false`) its domain must have an MX or A record.
→ `201 {"verificationRequired": true, "email"}`. **No session is started.** A single-use verification link
(`<APP_ORIGIN>/?verify=<token>`, valid `EMAIL_VERIFICATION_TTL_HOURS`) is emailed.
`409 email_taken` / `409 email_unverified_exists`, `422 disposable_email` / `422 email_domain_invalid`, `503 email_unavailable`.

### `POST /api/auth/verify-email` (rate limited: auth)
Body `{token}` → `200 {"user"}` + session cookie. Marks the email verified, deletes the token, and moves this
browser's free guest analysis into the account. `400 invalid_token` if unknown, used or expired.

### `POST /api/auth/resend-verification` (rate limited: auth)
Body `{email}` → always `202 {"message"}` (same response whether or not the account exists). Sends a new link only
for unverified accounts, at most once per 60 s per account; older links stop working.

### `POST /api/auth/login` (rate limited: auth)
Body `{email, password}` → `200 {"user"}` + cookie. `401` with the same message whether the email or the password
is wrong; `403 email_not_verified` for a correct password on an unverified account.

### `POST /api/auth/google` (rate limited: auth)
Body `{credential}` - the ID token from Google Identity Services. The server verifies signature, expiry, issuer and
audience (`GOOGLE_CLIENT_ID`) and requires `email_verified`.
→ `200 {"user"}` + cookie. Signs in the account linked to that Google ID; otherwise links the account with the same
email, or creates a verified account without a password. If the matching email account was **unverified**, its
password is removed and its pending links/sessions are revoked (Google proved the real owner).

### `POST /api/auth/logout`
Deletes the current device's session (if the cookie holds a valid token) and clears the cookie → always `204`. A
copied token stops working immediately; other devices stay signed in. (The guest cookie stays, so logging out doesn't
grant another free analysis.)

### `POST /api/auth/logout-all` (auth)
Deletes every session of the account and increments the token version → `204`.

### `GET /api/auth/me` (auth)
→ `200 {"user":{"name","email","hasPassword","googleLinked","emailVerified"}}` or `401`.

## Account (all require auth)

| Method & path | Body | Response |
|---|---|---|
| `GET /api/account/settings` | — | `{privacyMode, notifications}` |
| `PUT /api/account/settings` | `{privacyMode: bool, notifications: bool}` | same object |
| `PATCH /api/account` | `{name, email, currentPassword?}`. Changing the email needs `currentPassword`, passes the fake-email checks, clears `emailVerified` and the Google link, emails a new verification link, signs out other devices and re-issues the current cookie | `{user, verificationSent}` |
| `PUT /api/account/password` | `{currentPassword?, newPassword}` - `currentPassword` required if the account has a password; Google-only accounts set a first password without it | `204`; all sessions revoked, current cookie re-issued |
| `DELETE /api/account` | `{currentPassword}`, or `{confirm: "DELETE"}` for Google-only accounts | `204`; user, all analyses, sessions and usage counters permanently deleted, cookie cleared |

`PATCH`, `PUT /password` and `DELETE` share the auth rate limit.

## Analyses

### `POST /api/analyses` (rate limited: analysis; login **optional** for the first analysis)
Guests (no session) get **one** analysis per browser, tracked by the random `s2h_guest` httpOnly cookie and a
`guest_free_use` marker kept 365 days. The guest result always uses privacy mode and is kept in `guest_analyses` for
up to 30 days; it moves into the account (and is deleted from `guest_analyses`) when that browser signs
in. A guest's second request → `401 login_required` (checked before the upload is parsed).

`multipart/form-data`:

| Field | Type | Required | Notes |
|---|---|---|---|
| `resume` | file | yes | `.pdf` or `.docx`, ≤ 5 MB |
| `jdText` | text | one of `jdText` / `jdFile` | ≤ 50,000 chars after trimming (longer → `422 document_too_long`); takes precedence over `jdFile` |
| `jdFile` | file | one of `jdText` / `jdFile` | `.pdf`, `.docx` or `.txt`, ≤ 5 MB |
| `jdTitle` | text | no | ≤ 120 chars; guessed from the JD if empty |

→ `201 {"result": AnalysisResult}` (guests: `{"result", "guest": true}`)

Upload safety errors (security remediation P0; limits in `config.upload`):

| Status | Code | When |
|---|---|---|
| 422 | `file_too_complex` | DOCX: > 2,000 entries, > 20 MB declared, an XML part > 4 MB or all XML > 4 MB, a size lie, ZIP64/split/encrypted/unsupported compression/duplicate names, DTD in XML. PDF: a Flate stream inflating > 10 MB or all streams > 30 MB, a rejected filter. Generic message, never says which check failed |
| 422 | `file_too_complex` | Encrypted PDF (specific message, see above) |
| 422 | `file_corrupt` | Malformed archive or PDF |
| 422 | `document_too_long` | Resume text over 100,000 characters, pasted or uploaded JD text over 50,000 characters, or a PDF with more than 20 pages (security remediation P1, D-4). Documents are rejected, never truncated. Messages: "Your resume has more text than we can analyse (limit: 100,000 characters)." / "The job description has more text than we can analyse (limit: 50,000 characters)." / "This PDF has more than 20 pages. Please upload a shorter document." |
| 503 | `server_busy` | Two documents are already being parsed on this instance; retry after `Retry-After` seconds. Nothing is stored and a guest's free analysis is not used up |

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

The remaining analysis routes require auth, except `/latest`.

### `GET /api/analyses`
Newest first, max 100 → `{"analyses":[{id, date, score, jdTitle, resumeName, strongCount, partialCount, missingCount}]}`

### `GET /api/analyses/latest` (auth optional)
→ `{"result": AnalysisResult | null}` - the account's latest, or this browser's unclaimed guest analysis.

### `GET /api/analyses/:id` · `DELETE /api/analyses/:id`
`:id` must be a UUID (`400` otherwise). Queries always filter by the current user, so another user's id returns `404`.
GET → `{"result": AnalysisResult}`; DELETE → `204`.

## Assistant (requires auth)

### `GET /api/assistant/status`
→ `{"mode":"rules"|"gemini"}`

### `POST /api/assistant/chat` (rate limited: assistant + 60 per user per hour)
Body `{question: string (1–1000), analysisId?: uuid}`. Without `analysisId` the latest analysis is used.
→ `200 {"content": string, "sources": string[], "mode": "rules"|"gemini"}`. `404` if `analysisId` isn't yours.
`mode` is `"gemini"` only when Gemini is configured, the user (20/UTC day) and global (500/UTC day) quotas allow it,
and the Gemini wording passes validation against the stored facts; otherwise the deterministic answer is returned
with `mode: "rules"` and no error.

## Rate limits (per client IP)

| Limiter | Window | Max requests | Applies to |
|---|---|---|---|
| api | 15 min | 300 | every `/api` request |
| auth | 15 min | 10 | signup, login, profile/password/account-delete |
| analysis | 60 min | 30 | `POST /api/analyses` |
| assistant | 60 min | 60 | `POST /api/assistant/chat` |

These values are provisional; see [DECISIONS.md](DECISIONS.md). The IP limiters are disabled when `NODE_ENV=test`.

Per-account and per-user limits (security remediation P1, D-8; always active, in memory per instance):

| Limit | Window | Max | Key |
|---|---|---|---|
| failed logins | 15 min | 5 | HMAC of the normalised email (identical for known and unknown emails; a successful login resets it) |
| assistant requests | 60 min | 60 | user id |
