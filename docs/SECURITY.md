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
- **Password-hash slots (P1, D-5):** every scrypt operation (signup, login including the dummy hash, password change,
  email change, account deletion) runs in one of **2** slots per instance (each scrypt call uses ~134 MB). A request
  that gets no slot within **5 s** receives `503 server_busy` with `Retry-After: 5`.
- **User enumeration on login:** the same error message for unknown email and wrong password; a real scrypt
  comparison runs for unknown emails and Google-only accounts too, so response time doesn't reveal which. *Signup
  still returns 409 for an existing email (usability trade-off; the approved fix is planned for P2).*
- **Failed-login limit (P1, D-8):** at most **5** failed logins per account per **15 min**, on top of the IP limit.
  Keyed by an HMAC of the normalised email (no plaintext email kept in memory), so known and unknown addresses get
  the identical `429 rate_limited`; attempts are counted up front so parallel guesses can't pass the limit, and a
  successful login clears the count. In memory, per instance.
- **Session token:** HS256 JWT with `sub`, `tv`, `jti`, `iss`/`aud`, `algorithms` pinned (rejects `alg:none`), 7-day
  expiry by default, in an `HttpOnly`, `SameSite=Strict`, `Path=/api` cookie that is `Secure` in production. The
  token never reaches JavaScript.
- **Server-side sessions (P1, D-7):** each sign-in creates a `sessions` row whose id is the JWT's `jti`. A request is
  authenticated only if the JWT is valid, the user exists, `tv` matches, and a non-expired session row with that `jti`
  belongs to the same user. `POST /auth/logout` deletes the current row (a copied token stops working immediately;
  other devices stay signed in). `/auth/logout-all` and password change delete every row and bump `token_version`;
  password change then issues a new session for the current device. Email change deletes every row and reissues the
  current session (other devices signed out). Google sign-in that takes over an unverified registration deletes that
  account's sessions. Account deletion removes the rows by cascade. Expired rows are deleted when a session is
  created. Tokens issued before P1 have no `jti` and require a new login.
- **Secrets (P1, M-8):** `JWT_SECRET` (≥ 32 chars) is mandatory in production: a `NODE_ENV=production` server and
  the **Vercel production deployment** refuse to start without it. Vercel preview deployments may still use a
  per-instance random secret. Development generates a random secret file with mode 0600, which is git-ignored.

### CSRF
Three layers: `SameSite=Strict` cookies, a required custom header `X-Requested-With: skill2hire` on state-changing
methods (cross-site forms cannot set it, and cross-origin `fetch` with it triggers a preflight the API never
approves, since no CORS is enabled), and an `Origin` allow-list check.

### Authorization / IDOR
Every analysis query includes `user_id = <session user>`. Another user's analysis id returns `404` (not `403`, so
its existence isn't revealed). Route ids are validated as UUIDs.

### Input validation
All JSON bodies are validated with `zod` (strict objects where it matters). JSON body limit 100 KB. Multipart
limits: 2 files, 5 fields, 8 parts, 5 MB per file. JD text ≤ 50,000 chars and resume text ≤ 100,000 chars (longer → `422 document_too_long`, never truncated), question ≤ 1,000 chars, name ≤ 80
chars without `<>` or control characters. All SQL uses prepared statements with bound parameters.

### File upload hardening
- Memory storage only; nothing is written to disk.
- Extension allow-list + signature check (`%PDF-`, ZIP `PK\x03\x04`, TXT must not contain NUL and must be valid UTF-8).
- DOCX guard (`analysis/docx-guard.ts`, security remediation P0), run **before** mammoth/JSZip decompress anything:
  - ZIP structure: single end-of-central-directory record, no ZIP64, no split archives, central directory exactly where
    the record says, ≤ 2,000 entries, stored/deflate only, no encrypted entries, no duplicate names, no Info-ZIP
    Unicode Path fields, local headers that match the central directory → otherwise `422 file_too_complex` /
    `422 file_corrupt`.
  - Declared sizes: all entries ≤ 20 MB; every part mammoth may read as XML ≤ 4 MB each and ≤ 4 MB together. "XML
    part" means `.xml`/`.rels` names **plus every relationship target** (except image relationships to image files),
    so a text part can't escape the cap by being renamed (e.g. `word/main.dat`).
  - Size lies: each XML part is really inflated with an output cap of its declared size + 1 byte; its real length and
    CRC-32 must match. (Before P0, a 381 KB file declaring 1 KB was fully inflated to 400 MB by JSZip.)
  - Any XML part with `<!DOCTYPE` or `<!ENTITY` (UTF-8 or UTF-16) is rejected.
- PDF pre-scan (`analysis/pdf-guard.ts`), run **before** pdf.js is loaded (pdf.js has no inflate limit of its own):
  - Encrypted PDFs (any `/Encrypt` entry, including escaped names) → `422 file_too_complex` "Encrypted or
    password-protected PDFs aren't supported. Please upload an unprotected PDF."
  - Allowed stream filters: none, a single `FlateDecode`, or a single image codec that text extraction doesn't expand
    (DCT, JPX, CCITTFax, JBIG2). LZW, RunLength, ASCII85, ASCIIHex, Crypt, unknown filters, filter chains and
    indirect `/Filter` values are rejected.
  - Every Flate stream is inflated in 64 KB chunks, counting and discarding the output, until the deflate stream really
    ends. `/Length` and `endstream` are not trusted. One stream > 10 MB or all streams > 30 MB → rejected.
  - pdf.js 5.4.296 (includes the fix for CVE-2024-4367), `isEvalSupported: false`. PDFs with more than 20 pages are rejected
    (`422 document_too_long`) after pdf.js reports the page count and before any page text is extracted.
- Parse slots (`analysis/parse-slots.ts`): at most 2 documents are parsed at the same time per server instance; extra
  uploads get `503 server_busy` with `Retry-After: 5` and nothing is stored (a guest's free analysis isn't used up).
- These are structural and resource checks, **not** antivirus or malware scanning.
- Client filenames are stripped of path components and control/reserved characters, and anonymised in privacy mode.
- Parse errors return a generic 422 message and never echo parser internals.

### HTTP hardening (helmet)
CSP `default-src 'self'; script-src 'self'; object-src 'none'; frame-ancestors 'none'; base-uri 'self';
form-action 'self'; connect-src 'self'` (`style-src` allows `'unsafe-inline'` because Radix ScrollArea injects a
`<style>` tag), HSTS in production, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`,
`X-Powered-By` removed, `Cache-Control: no-store` on API responses.

### Rate limiting
See [API.md](API.md#rate-limits-per-client-ip). Set `TRUST_PROXY=true` behind a proxy, otherwise every client
shares the proxy's IP. P1 adds per-account (5 failed logins / 15 min) and per-user (60 assistant requests / hour)
limits; all limiters are in memory and per instance.

### Error handling
Unhandled errors are logged server-side and return `{"code":"internal","message":"Something went wrong"}`, with no
stack traces.

### LLM safety (optional Gemini, security remediation P1 D-9)
- Gemini is only a phrasing layer. Scores, components, skill matching, Strong/Partial/Missing, evidence and Why Not Me
  always come from the deterministic engine; Gemini never writes to a stored analysis.
- **Quota:** 20 Gemini answers per user and 500 in total per UTC day. One unit is reserved atomically (a single
  `BEGIN IMMEDIATE` transaction) **before** Gemini is called, so rejected output still counts; the single retry after a
  "thinking" setting error is the same unit. After the quota the rules answer is returned silently (`mode: "rules"`).
- **Redaction:** email addresses, phone numbers and links are removed from every string sent (facts, evidence, Why
  Not Me, the rules draft and the question) **regardless of privacy mode**. The file name and ids are never sent.
  This is pattern-based redaction of contact details, not detection of every personal reference (e.g. names).
- **Injection boundary:** the facts, draft and question are sent as one JSON object; the system instruction says every
  string value is untrusted data and never an instruction.
- **Output validation:** the answer is discarded (rules answer used) unless the finish reason is `STOP`, it has at most
  4,000 characters (never truncated), contains no links, every number appears in the facts or draft (allowing
  rounding and a trailing `%`), a named skill's Strong/Partial/Missing word in the same sentence matches its stored
  rating, and every double-quoted text appears in the facts or draft. Paraphrased contradictions without a rating word
  can't be detected.
- Timeout 15 s, 1024 output tokens, temperature 0.2 (unchanged). Failures, timeouts, quota and rejections log only a
  reason code, never the question, evidence or generated text. Output is rendered as text.
- **Disclosure:** when Gemini is on, the Assistant page shows: "When AI phrasing is on, your question and the relevant
  analysis facts (with contact details removed) are sent to Google Gemini to word the answer. Scores and skill ratings
  always come from Skill2Hire's rules."
- Per-user limit: 60 assistant requests per hour (P1, D-8), in addition to the per-IP limit.

### Privacy
- Uploaded files are discarded after parsing; stored results contain at most short evidence snippets.
- Privacy mode (default on) redacts contact details and anonymises the filename.
- Users can delete individual analyses or their whole account. Account deletion permanently removes all of the
  account's analyses, sessions and assistant usage counters (hard delete, no soft delete).
- **Guest data (P1, D-6):** a guest's free analysis writes a `guest_free_use` marker (random browser id + time, no
  content, kept **365 days**) and the result to `guest_analyses` (kept **30 days** while unclaimed). When that browser
  signs in, the result is copied into the account and **deleted** from `guest_analyses`; the marker stays so the free
  analysis remains used. Expired guest results and markers are deleted during normal guest requests (analysis, latest
  result, sign-in); there is no background job. A browser whose marker is older than 365 days may use a free analysis
  again.
- **Preview storage (D-1):** the Vercel preview stores SQLite in `/tmp`, separately for each serverless instance.
  Data can reset whenever an instance is recycled or redeployed, and accounts, sessions, guest markers, quotas and
  rate-limit counters aren't shared between instances. It is not a persistent production database.

## 2b. Accounts, verification and guest access (v1.1)

| Control | Implementation |
|---|---|
| Email ownership | Sign-up creates an **unverified** account and no session. A 256-bit random token is emailed as `<APP_ORIGIN>/?verify=<token>`; only its SHA-256 hash is stored. Tokens are single-use, expire (default 24 h), and are replaced when a new one is sent. Login is refused (`403 email_not_verified`) until verified. |
| Link host | Links are built from `APP_ORIGIN` (env), never from the request's `Host` header, so they can't be poisoned to point elsewhere. |
| Token leakage | The frontend removes `?verify=` from the address bar immediately (`history.replaceState`) and exchanges it via POST, so it isn't kept in history. |
| Fake emails | `mailchecker` blocklist (thousands of disposable/temp-mail domains, regularly updated) + DNS check that the domain has an MX (or A) record and no RFC 7505 null MX. DNS timeouts fail open (logged), since the verification link is the real proof of ownership. Applied to sign-up and email changes. |
| Resend abuse / enumeration | `resend-verification` always returns the same 202 message, sends only for unverified accounts, and has a 60 s per-account cooldown on top of the IP rate limit. |
| Email change | Requires the current password, re-runs the fake-email checks, marks the account unverified, removes the Google link, emails a new link, signs out all other devices and reissues the current session (P1, D-7). |
| Google sign-in | Google Identity Services popup → ID token → server verifies with `google-auth-library` (Google's rotating keys, `exp`, `iss`, `aud` = our client ID) and requires `email_verified`. Accounts are matched by Google `sub`, never by a client-supplied email. No client secret is used. |
| Pre-registration takeover | If someone registered a victim's email with a password but never verified it, the victim's first Google sign-in removes that password, revokes its sessions (session rows deleted and token version bumped) and deletes pending links. |
| Google-only accounts | Stored password marker `!` can never verify. They can set a first password in Settings; deletion requires typing `DELETE`. |
| Guest analysis | One per browser via a random 192-bit `s2h_guest` cookie (httpOnly, SameSite=Strict, `Path=/api`). Checked **before** the upload is parsed against the `guest_free_use` marker; the marker (primary key = guest id) and the result are written in one transaction, so parallel requests from one browser can't both get a free analysis. Guests always get privacy mode. History, assistant and settings stay behind login. |
| Guest limit bypass | Incognito windows or clearing cookies give another free analysis. This was accepted so classmates on shared Wi-Fi aren't blocked (D-34); the per-IP analysis rate limit (30/h) still applies. |
| CSP for Google | `script-src` adds only `https://accounts.google.com/gsi/client`, `frame-src`/`connect-src` only `https://accounts.google.com/gsi/`, `style-src` its stylesheet; `Cross-Origin-Opener-Policy: same-origin-allow-popups` so the popup can return the credential. |

## 3. Verified by tests

`server/tests/api.test.ts` checks: hardened cookie flags, duplicate/weak/invalid signup, generic login errors,
CSRF header and foreign-origin rejection, forged `alg:none` token rejection, security headers, password change
revoking other sessions, password required for email change and deletion, auth required for uploads, spoofed file
(415), oversize file (413), cross-user read/delete/assistant access (404), UUID validation.
`server/tests/analysis.test.ts` checks zip-bomb rejection, content/extension mismatch, filename sanitising and PII redaction.
P1 adds `password-slots.test.ts`, `sessions.test.ts`, `guest-lifecycle.test.ts`, `rate-limits.test.ts`,
`gemini-guard.test.ts` (fake Gemini only), `config-secret.test.ts`, `ownership-queries.test.ts` (every prepared
statement on an owned table must filter by its owner), `migration.test.ts` and `text-limits.test.ts`.
`server/tests/docx-guard.test.ts` (25 tests) and `server/tests/pdf-guard.test.ts` (31 tests) cover every DOCX and PDF
guard rule with synthetic, hand-built archives and PDFs; the "upload safety (P0)" suite in `api.test.ts` sends DOCX
and PDF bombs and an encrypted PDF through the real endpoint and checks the busy response and slot release.

### Security remediation P0 measurements (2026-09-14, local Windows, Node 24 via `tsx`)

**Audit probes** (`extractText()` called directly, each in a fresh process):

| Case | Result | Time | Peak memory |
|---|---|---|---|
| 129 KB DOCX with 45 MB of XML (was 3.46 GB, 15.5 s) | Rejected 422 | 0 ms | 71 MB |
| 381 KB DOCX lying about a 400 MB part (was 470 MB) | Rejected 422 | 3 ms | 71 MB |
| 285 KB PDF with a 300 MB Flate stream (was accepted, 1.15 GB) | Rejected 422 | 19 ms | 83 MB |

**Concurrent parsing through the real route.** An earlier run reported **852 MB** for two cap-sized documents at once.
That figure came from a shortcut harness that called `extractText()` directly (no Express, multer, parse slots or
`analyze()`) with Node's default heap limit. **It is not the final measurement.** The corrected measurement:

- Fixtures (a 4 MB dense-paragraph DOCX at the XML cap; a PDF with 3 × 10 MB Flate text streams at the caps) were
  generated once in a separate process and read from disk.
- One process created the real app and sent real `POST /api/analyses` uploads through supertest: Express → multer →
  parse slots → DOCX/PDF guard → mammoth/pdf.js → `analyze()`. A wrapper confirmed both parse slots were in use at once;
  all uploads returned 201.
- A separate thread sampled process RSS every 10 ms (agreed with the OS peak within 9 MB).
- Each case ran with Node's default heap limit (4.3 GB on the test machine) and with the heap capped to 960 MB and
  704 MB, as on a ~1 GB machine. With a large heap allowance V8 frees memory late, which inflates RSS.

| Peak RSS (MB) | Default heap (4.3 GB) | Heap cap 960 MB | Heap cap 704 MB |
|---|---|---|---|
| Baseline, app loaded (includes ~38 MB `tsx` overhead) | 147–163 | 136–138 | 135–144 |
| Tiny PDF (pdf.js fixed cost on its first document) | 650 | 578 | 579 |
| DOCX at the XML cap alone | 759 | 681 | 618 |
| PDF at the caps alone (12–14 s) | 785 | 716 | 711 |
| **DOCX + PDF at once** | 1,182–1,194 | **862** | 761 |
| PDF + PDF at once (26–28 s) | 907 | 838 | 709 |

No run ran out of memory. **Corrected worst case: ~862 MB** (960 MB heap cap, DOCX + PDF at once), leaving a margin
of **~162 MB (~16%)** against the 1024 MB Vercel function limit (~200 MB without the `tsx` overhead, which Vercel
doesn't have). The exact heap limit and runtime overhead of Vercel's Node were **not** verified locally; check real
peak memory on the Vercel preview. This is not a P0 memory blocker, and no limit or parse-slot count was changed.

**Timing:** two capped PDFs parsed at once took **26–28 s** locally, close to Vercel's 30 s function timeout. This is
a P2 concern (worker-thread timeout, D-11), not a P0 memory blocker.

## 4. Known limitations / residual risk

| Risk | Notes / recommendation |
|---|---|
| No email verification or password reset | Needs an email provider (OPEN DECISION D-12) |
| No CAPTCHA | IP limits plus a per-account failed-login limit (5 / 15 min); a CAPTCHA isn't implemented |
| No MFA | Out of scope for this micro project |
| In-memory rate-limit and failed-login counters; per-instance SQLite on the Vercel preview | Counters reset on restart and, like sessions, guest markers and Gemini quotas on the preview's `/tmp` database, aren't shared across Vercel instances (D-1: preview only). A persistent shared store is a separate architecture decision before real public use |
| First unknown-email login on an instance | Creates the dummy hash once (an extra scrypt call), so that one response is slower; later logins take equal time |
| Existing sessions after deploying P1 | Tokens without a `jti` are rejected, so every user logs in once after deployment |
| PDF/DOCX parsing runs on the main event loop | Size caps and the 2-slot limit bound memory, but a cap-sized document still blocks other requests on that instance for several seconds. A worker-thread timeout is planned for P2 after a Vercel bundling check |
| Peak memory near the Vercel function size | Measured locally through the real route: two cap-sized parses at once peaked at ~862 MB with a 960 MB heap cap (~162 MB / ~16% margin to Vercel's 1024 MB). The earlier 852 MB shortcut-harness figure is superseded. pdf.js alone peaks at ~578 MB on its first document, before any P0 change. Caps were **not** changed; Vercel's heap limit and runtime overhead weren't verified, so revalidate on the Vercel preview |
| Slow concurrent PDF parsing | Two capped PDFs at once took 26–28 s locally, close to Vercel's 30 s function timeout. P2 concern (worker-thread timeout), not a P0 memory blocker |
| Legitimate PDFs refused by the SEC-D3 policy | Encrypted/owner-password PDFs, LZW/RunLength/ASCII filters, filter chains such as `[/FlateDecode /DCTDecode]`, and Flate images larger than 10 MB decompressed are rejected with a clear 422 |
| Inline images inside content streams | Not visible to the pre-scan; measured that pdf.js text extraction does not decode them (a 196 MB inline image left peak memory unchanged). A regression test keeps this covered |
| `style-src 'unsafe-inline'` | Needed by Radix ScrollArea; low risk because `script-src` is strict |
| SQLite file is not encrypted at rest | Use disk encryption on the host; passwords are hashed regardless |
| Signup reveals whether an email is registered | Accepted trade-off (see above) |
| `npm audit`: 0 vulnerabilities as of 2026-09-13 | Re-run regularly; install scripts for esbuild/protobufjs were not auto-approved by npm and weren't needed |
