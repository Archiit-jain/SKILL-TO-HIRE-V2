# RAG Security Guardrails (design only)

Security remediation **P3**. Skill2Hire V2 has **no retrieval-augmented generation (RAG)**: there are no embeddings,
vector store or retrieval step. This document defines the controls any future RAG feature must implement **before**
it is enabled. Nothing here is implemented yet, and no numeric value in it is approved; values marked
*OWNER DECISION* must be decided when the feature is designed.

It extends the Gemini controls already in place (security remediation P1, D-9; see [SECURITY.md](SECURITY.md)): Gemini is
only a phrasing layer, scores/ratings/evidence come from the deterministic engine, questions and document text are
untrusted data, answers are validated and fall back to the rules answer.

## 1. Trust levels

| Source | Trust | May it contain instructions the model follows? |
|---|---|---|
| System instruction written by Skill2Hire | Trusted | Yes |
| Deterministic analysis facts (scores, ratings, evidence ids) | Trusted as **data** | No |
| Curated knowledge base (reviewed course/skill descriptions) | Trusted as **data** after review | No |
| User resumes, job descriptions, questions, file names | **Untrusted** | No |
| Anything retrieved from a user-supplied document | **Untrusted** | No |

Rules:
- Untrusted text is only ever placed inside a JSON payload field (as in D-9), never concatenated into instruction prose.
- Each retrieved chunk is sent as `{ "source_id", "source_type": "knowledge_base" | "user_document", "text" }` so the
  model and the validator can tell trusted reference material from untrusted user content.
- The system instruction states that every string value is data and that retrieved text can't change the rules,
  reveal them, or change scores and ratings.

## 2. Source isolation (no cross-user retrieval)

- User documents and their embeddings are **owned rows**: every row carries `user_id` (or `guest_id` for guest data),
  and every read, similarity search, update and delete filters by the owner. The existing architecture test
  (`server/tests/ownership-queries.test.ts`) must be extended to the new tables before release.
- Similarity search over user documents runs **after** the owner filter (a pre-filtered index or a per-user
  partition), never "search everything, then filter", so another user's chunk can't be returned or influence ranking.
- The shared knowledge base is a separate, read-only index. User uploads are **never** written into it.
- Account deletion and guest-retention expiry (D-6) must delete the user's chunks and embeddings together with the
  analysis content (hard delete). Retention of embeddings: *OWNER DECISION* (must not exceed the content's retention).

## 3. Retrieval poisoning

- Only reviewed content enters the knowledge base. Each entry records its source (URL or author), reviewer, review date
  and a content hash; ingestion refuses entries without them.
- Re-ingestion compares hashes; any change requires a new review.
- User documents are never used as knowledge-base evidence for other users.
- Retrieved text is checked with the same limits as uploads (length caps, no silent truncation) before it is sent.
- Maximum chunks per request and maximum characters per chunk: *OWNER DECISION*.

## 4. Prompt boundary

- Payload shape (extends D-9): `{ analysis_facts, draft_answer, retrieved_sources: [...], user_question }`, serialised
  with `JSON.stringify`.
- Contact details are redacted from every string sent (as in D-9), regardless of privacy mode; file names and internal
  ids other than `source_id` are never sent.
- No tool use, code execution, browsing or follow-up retrieval driven by model output.

## 5. Output validation (must pass before an answer is shown)

All D-9 checks still apply (finish reason `STOP`, length limit without truncation, no links, numbers must appear in the
facts/draft/sources, Strong/Partial/Missing must match stored ratings, quotes must appear verbatim). In addition:
- Every citation must reference a `source_id` that was actually sent in this request.
- A quote attributed to a source must appear in that source's text.
- Facts about the user (skills, experience, scores) may only come from `analysis_facts`, never from retrieved text.
- Any failure discards the answer and returns the deterministic rules answer; only a reason code is logged.

## 6. Cost and abuse

- Retrieval requests count against the existing assistant limits (60 requests per user per hour, D-8) and the Gemini
  quotas (20 per user and 500 in total per UTC day, D-9); embedding calls to an external provider need their own quota:
  *OWNER DECISION*.
- Embedding generation for uploads runs inside the upload's parse slot and parse deadline (D-5, D-11).

## 7. Privacy disclosure

Before enabling RAG, the Assistant disclosure must be updated to say which document text is embedded, where embeddings
are stored, which provider receives it (if any) and how long it is kept. The current disclosure text (D-9) only covers
questions and analysis facts sent to Google Gemini.

## 8. Release checklist

- [ ] Owner decisions above made and recorded in DECISIONS.md
- [ ] Owned-table ownership test extended to embedding/chunk tables
- [ ] Cross-user retrieval test: user B's query can never return user A's chunk (including near-duplicate text)
- [ ] Poisoning test: an unreviewed or modified knowledge-base entry is refused
- [ ] Injection tests: instructions inside a retrieved chunk don't change rules, numbers or ratings
- [ ] Citation validation tests (unknown `source_id`, misattributed quote)
- [ ] Deletion test: account deletion and guest expiry remove chunks and embeddings
- [ ] Disclosure updated and reviewed
