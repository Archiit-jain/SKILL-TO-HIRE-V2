# Security Review & Patches

## 1. Findings in the original frontend-only code

| # | Severity | File | Finding | Patch |
|---|---|---|---|---|
| S-01 | Critical | `hooks/useAuth.ts` | Login accepted **any** email/password; signup stored nothing; the password was ignored | Real backend auth: scrypt password hashes, signed session cookie, `GET /auth/me` restore |
| S-02 | High | `SettingsPage.tsx` | Password field pre-filled with the hard-coded value `password123`, revealable with the eye button | Removed. Password change now needs the current password and is verified server-side |
| S-03 | High | `SettingsPage.tsx` | "Delete Account" did nothing, while the UI promised permanent deletion | `DELETE /api/account` with password confirmation; cascades to all analyses |
| S-04 | High | `AnalysisPage.tsx` | Only file size was checked (client-side); any file type could be selected via drag-and-drop | Server checks the extension allow-list **and** file signature (magic bytes), 5 MB multer limit, zip-bomb precheck, PDF page cap; the client pre-checks for UX only |
| S-05 | Medium | `AuthPage.tsx`, `SettingsPage.tsx`, `HomePage.tsx`, `AnalysisPage.tsx` | Inaccurate privacy claims ("encrypted and never shared", "never stored permanently… we keep extracted text") | Copy rewritten to match actual behaviour: files processed in memory and discarded, only results saved, deletable |
| S-06 | Medium | `SettingsPage.tsx` | Email could be edited freely (account takeover if a session is hijacked) | Email change requires the current password; uniqueness enforced |
| S-07 | Medium | `AssistantPage.tsx` | Enter key sent messages even while a reply was pending (duplicate or racing requests); ids from `Date.now()` could collide | Submit guarded by `isTyping`; ids from `crypto.randomUUID` with fallback; question length capped at 1000 |
| S-08 | Medium | App-wide | No session persistence or logout invalidation | httpOnly cookie restore; token-version revocation on password change and logout-all |
| S-09 | Low | `AssistantPage.tsx` | Assistant output will contain markdown/LLM text; a naive markdown renderer would risk XSS | `**bold**` rendered by building React elements only; no `dangerouslySetInnerHTML` anywhere |
| S-10 | Low | `AuthPage.tsx` | Missing `autoComplete`, `maxLength`, `aria-label` on password toggle | Added |
| S-11 | Low | Buttons | Dead buttons (Roadmap "Start New Analysis", "Re-analyze") | Wired to navigation |
| S-12 | Info | Project | No `package.json`, build config or `components/ui` files, so the code could not run at all | Added |

## 2. Backend controls

### Authentication & sessions
- **Password hashing:** `scrypt` (N=2^17, r=8, p=1, 16-byte random salt, 64-byte key). Parameters are stored with
  each hash, and comparison is constant-time (`timingSafeEqual`). Passwords are NFKC-normalised; length 8–128.
- **User enumeration on login:** the same error message for unknown email and wrong password; a dummy hash is
  verified for unknown emails so response time doesn't reveal which. *Signup still returns 409 for an existing
  email (usability trade-off, mitigated by rate limiting).*
- **Session token:** HS256 JWT with `iss`/`aud`, `algorithms` pinned (rejects `alg:none`), 7-day expiry by default,
  in an `HttpOnly`, `SameSite=Strict`, `Path=/api` cookie that is `Secure` in production. The token never reaches JavaScript.
- **Revocation:** `token_version` claim; password change and `/auth/logout-all` invalidate every other session.
  Deleting the account invalidates everything.
- **Secrets:** `JWT_SECRET` (≥ 32 chars) is mandatory in production and the process exits without it. Development
  generates a random secret file with mode 0600, which is git-ignored.

### CSRF
Three layers: `SameSite=Strict` cookies, a required custom header `X-Requested-With: skill2hire` on state-changing
methods (cross-site forms cannot set it, and cross-origin `fetch` with it triggers a preflight the API never
approves, since no CORS is enabled), and an `Origin` allow-list check.

### Authorization / IDOR
Every analysis query includes `user_id = <session user>`. Another user's analysis id returns `404` (not `403`, so
its existence isn't revealed). Route ids are validated as UUIDs.

### Input validation
All JSON bodies are validated with `zod` (strict objects where it matters). JSON body limit 100 KB. Multipart
limits: 2 files, 5 fields, 8 parts, 5 MB per file. JD text ≤ 50,000 chars, question ≤ 1,000 chars, name ≤ 80
chars without `<>` or control characters. All SQL uses prepared statements with bound parameters.

### File upload hardening
- Memory storage only; nothing is written to disk.
- Extension allow-list + signature check (`%PDF-`, ZIP `PK\x03\x04`, TXT must not contain NUL and must be valid UTF-8).
- DOCX: the ZIP central directory is parsed **before** decompression; archives declaring > 50 MB uncompressed or
  > 2000 entries, or using ZIP64, are rejected.
- PDF: pdf.js 5.4.296 (includes the fix for CVE-2024-4367), `isEvalSupported: false`, first 20 pages only.
- Client filenames are stripped of path components and control/reserved characters, and anonymised in privacy mode.
- Parse errors return a generic 422 message and never echo parser internals.

### HTTP hardening (helmet)
CSP `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';
form-action 'self'; connect-src 'self'` (`style-src` allows `'unsafe-inline'` because Radix ScrollArea injects a
`<style>` tag), HSTS in production, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Powered-By` removed, `Cache-Control: no-store` on API responses.

### Rate limiting
See [API.md](API.md#rate-limits-per-client-ip). Set `TRUST_PROXY=true` behind a proxy, otherwise every client
shares the proxy's IP.

### Error handling
Unhandled errors are logged server-side and return `{"code":"internal","message":"Something went wrong"}`, with no
stack traces.

### LLM safety (optional Gemini)
- Gemini never decides scores or statuses; it only rephrases a validated draft.
- The user question is delimited and declared as data in the system instruction (prompt-injection mitigation).
- Output is length-capped, rendered as text, and replaced by the rule-based answer on any failure or timeout.
- Only the analysis summary (skills, sections, short redacted evidence) is sent, never the full resume.

### Privacy
- Uploaded files are discarded after parsing; stored results contain at most short evidence snippets.
- Privacy mode (default on) redacts contact details and anonymises the filename.
- Users can delete individual analyses or their whole account.

## 2b. Accounts, verification and guest access (v1.1)

| Control | Implementation |
|---|---|
| Email ownership | Sign-up creates an **unverified** account and no session. A 256-bit random token is emailed as `<APP_ORIGIN>/?verify=<token>`; only its SHA-256 hash is stored. Tokens are single-use, expire (default 24 h), and are replaced when a new one is sent. Login is refused (`403 email_not_verified`) until verified. |
| Link host | Links are built from `APP_ORIGIN` (env), never from the request's `Host` header, so they can't be poisoned to point elsewhere. |
| Token leakage | The frontend removes `?verify=` from the address bar immediately (`history.replaceState`) and exchanges it via POST, so it isn't kept in history. |
| Fake emails | `mailchecker` blocklist (thousands of disposable/temp-mail domains, regularly updated) + DNS check that the domain has an MX (or A) record and no RFC 7505 null MX. DNS timeouts fail open (logged), since the verification link is the real proof of ownership. Applied to sign-up and email changes. |
| Resend abuse / enumeration | `resend-verification` always returns the same 202 message, sends only for unverified accounts, and has a 60 s per-account cooldown on top of the IP rate limit. |
| Email change | Requires the current password, re-runs the fake-email checks, marks the account unverified, removes the Google link, and emails a new link. |
| Google sign-in | Google Identity Services popup → ID token → server verifies with `google-auth-library` (Google's rotating keys, `exp`, `iss`, `aud` = our client ID) and requires `email_verified`. Accounts are matched by Google `sub`, never by a client-supplied email. No client secret is used. |
| Pre-registration takeover | If someone registered a victim's email with a password but never verified it, the victim's first Google sign-in removes that password, revokes its sessions (token version bump) and deletes pending links. |
| Google-only accounts | Stored password marker `!` can never verify. They can set a first password in Settings; deletion requires typing `DELETE`. |
| Guest analysis | One per browser via a random 192-bit `s2h_guest` cookie (httpOnly, SameSite=Strict, `Path=/api`). Checked **before** the upload is parsed; a conditional `INSERT ... WHERE NOT EXISTS` stops parallel requests claiming two. Guests always get privacy mode. History, assistant and settings stay behind login. |
| Guest limit bypass | Incognito windows or clearing cookies give another free analysis. This was accepted so classmates on shared Wi-Fi aren't blocked (D-34); the per-IP analysis rate limit (30/h) still applies. |
| CSP for Google | `script-src` adds only `https://accounts.google.com/gsi/client`, `frame-src`/`connect-src` only `https://accounts.google.com/gsi/`, `style-src` its stylesheet; `Cross-Origin-Opener-Policy: same-origin-allow-popups` so the popup can return the credential. |

## 3. Verified by tests

`server/tests/api.test.ts` checks: hardened cookie flags, duplicate/weak/invalid signup, generic login errors,
CSRF header and foreign-origin rejection, forged `alg:none` token rejection, security headers, password change
revoking other sessions, password required for email change and deletion, auth required for uploads, spoofed file
(415), oversize file (413), cross-user read/delete/assistant access (404), UUID validation.
`server/tests/analysis.test.ts` checks zip-bomb rejection, content/extension mismatch, filename sanitising and PII redaction.

## 4. Known limitations / residual risk

| Risk | Notes / recommendation |
|---|---|
| No email verification or password reset | Needs an email provider (OPEN DECISION D-12) |
| No account lockout / CAPTCHA | IP rate limiting only; per-account throttling could be added |
| No MFA | Out of scope for this micro project |
| In-memory rate-limit store | Resets on restart and isn't shared across instances; use a Redis store if scaled horizontally |
| PDF parsing runs on the main event loop | A very complex PDF can block other requests briefly; move to a worker thread for multi-user deployment |
| `style-src 'unsafe-inline'` | Needed by Radix ScrollArea; low risk because `script-src` is strict |
| SQLite file is not encrypted at rest | Use disk encryption on the host; passwords are hashed regardless |
| Signup reveals whether an email is registered | Accepted trade-off (see above) |
| `npm audit`: 0 vulnerabilities as of 2026-09-13 | Re-run regularly; install scripts for esbuild/protobufjs were not auto-approved by npm and weren't needed |
