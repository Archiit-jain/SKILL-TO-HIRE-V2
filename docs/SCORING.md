# How Scoring Works

Engine version: `rules-tfidf-2.0` (`server/src/analysis/`). It is fully deterministic: the same inputs (and the same
analysis date, which matters for "Present" in date ranges) always give the same result. No machine-learning model is
trained or downloaded, and the optional Gemini integration never touches scoring.

> **Accuracy has not been evaluated** on a labelled dataset of real resumes and job descriptions. The rules and
> weights below are a transparent baseline, not a validated hiring predictor, and the UI says so next to the score.

Results saved by engine 1.0 still open: the frontend and assistant fall back to the fields those results have.

## 1. Text extraction (`extract.ts`, `document-parser.ts`)

| Input | Parser | Limits |
|---|---|---|
| PDF | `pdf-parse` 2.4.5 (pdf.js 5.4.296, `isEvalSupported: false`) in a worker thread | At most 20 pages (checked before any text is extracted); pre-scan: no encryption, allowed filters only, Flate ≤ 10 MB per stream / 30 MB total (see `SECURITY.md`) |
| DOCX | `mammoth` 1.12.3 raw text in the same worker | Guard: ≤ 2,000 entries, ≤ 20 MB declared, XML parts ≤ 4 MB each and in total, real sizes + CRC verified |
| TXT (JD only) | strict UTF-8 decode | No NUL bytes |

All documents of one request must finish within 20 seconds, otherwise the worker is terminated (`422 file_too_complex`).
Text is normalised and never truncated: a resume over 100,000 characters or a JD over 50,000 characters is rejected with
`422 document_too_long`. Each needs at least 50 characters. Scanned PDFs without a text layer are rejected.

## 2. Resume sections (`sections.ts`)

Lines of five words or fewer that match a known heading switch the current section: `summary`, `skills`, `experience`,
`projects`, `education`, `certifications`. Lines before any heading are `other` (shown as "General").

## 3. Skill dictionary (`skills.ts`)

124 curated skills in 14 categories. Matching uses token boundaries that handle `C++`, `C#`, `.NET` and `Node.js`.

**An alias must mean the same skill.** `K8s`, `kubectl`, `EKS` are Kubernetes; `Postgres` is PostgreSQL; `Golang` is Go.
Different-but-related technologies are separate skills:

| Not the same | Why |
|---|---|
| Docker ≠ Kubernetes | building/running containers vs orchestrating them |
| Git ≠ GitHub / GitLab / Bitbucket | the tool vs hosting platforms |
| React / TypeScript / Node.js ≠ JavaScript | built on JavaScript, not JavaScript experience itself |
| PostgreSQL / MySQL / … ≠ SQL, and ≠ each other | a specific database vs the language, or another database |
| C ≠ C++ ≠ C# | different languages |
| OAuth ≠ JWT | protocol vs token format |
| AWS ≠ Azure ≠ Google Cloud | different providers |

`RELATED` in `skills.ts` records these links. **Related evidence is never counted as a match**: the skill stays Missing,
and the result shows the related skill with a note, so the candidate can name the real skill if they have used it.
Version 1.0 treated `GitHub`, `version control`, `containerization`, `JWT`, `Unix` and a bare `Lambda` as aliases; 2.0
removed those.

Ambiguous words:
- Aliases that are ordinary English words (`Swift`, `Rust`, `Spark`, `Excel`, `REST`, …) only match with exact casing.
  A line that matches **only** through such a word, with no other recognised skill on it ("Swift turnaround on tickets"),
  is weak evidence: the rating stands but its confidence is **low**. "Built iOS apps in Swift" is not ambiguous.
- `C`, `R` and `Go` only match through unambiguous phrasings (`C programming`, `RStudio`, `Golang`, `C/C++`).

Only skills in the dictionary are recognised. **Add missing technologies there** (and to `RELATED` if needed).

## 4. Job description decomposition (`requirements.ts`)

The JD is split into lines and sentences. Each sentence remembers the heading it sits under:
- required headings: *Requirements, Qualifications, Must have, Minimum, What you'll need, Responsibilities, Skills, …*
- preferred headings: *Preferred, Nice to have, Good to have, Bonus, Desired, Additional, …*
- non-requirement headings: *Benefits, Perks, What we offer, Compensation, How to apply, About the company/team*.
  Skills mentioned only there are **not** requirements.

A heading is a short line (≤ 4 words) or a short label before a colon (`Preferred: Terraform`).

For each sentence, required vs preferred is decided in this order, and the reason is stored as `typeReason`:

| Rule | Type | Confidence |
|---|---|---|
| Sentence has a preferred cue (*preferred, nice to have, bonus, a plus, desirable, advantage, optional, ideally*) | preferred | high |
| Under a preferred heading | preferred | high |
| Under a required heading | required | high |
| Has a required cue (*must, required, essential, minimum, strong, hands-on, experience with, …*) | required | high |
| Before any heading (role description) | required | medium |
| Otherwise | required | medium |

A skill mentioned in several sentences is **required if any mention is required**; the deciding sentence is stored as
`jdEvidence`. A requirement recognised only from ambiguous words gets confidence **low**.

The decomposition also extracts:
- **Experience:** the first sentence with `N+ years … experience` / `N-M years experience` (minimum used).
- **Education:** the lowest degree level named, whether the JD accepts **equivalent experience** ("or equivalent"),
  and whether it names a field of study (the field is not checked against the resume, and the UI says so).
- **Certifications:** each sentence mentioning certification, per skill named in it (or a general certification).

All of these appear in `requirements` with `kind`, `label`, `category`, `requirementType`, `jdEvidence`, `typeReason`,
`confidence`, and in the "How the job description was read" panel.

## 5. Skill status and evidence

For each JD skill, find the resume lines that mention it:

| Status | Rule |
|---|---|
| **Strong** | Mentioned in an `experience` or `projects` line, or in an unsectioned line with an action verb (built, developed, deployed, packaged, …) |
| **Partial** | Mentioned only elsewhere (skills list, summary, education, certifications) |
| **Missing** | Not mentioned anywhere |

**Evidence** is the qualifying line whose TF-IDF vector is closest to the JD sentence for that skill, trimmed to 240
characters. Every skill carries:

| Field | Meaning |
|---|---|
| `reason` | Plain-language explanation of the rating |
| `jdEvidence` | The JD sentence that asks for the skill |
| `evidence`, `section` | The resume line used (Strong/Partial) |
| `related` | Related-but-different skills found (Missing only), with their resume line and a note |
| `confidence` | see below |

Confidence per skill:

| Case | Confidence |
|---|---|
| Strong, in Experience/Projects, line has an action verb | high |
| Strong, in Experience/Projects, no action verb ("Python - tooling team") | medium |
| Strong through an action statement outside a recognised heading | medium |
| Partial, and the resume has an Experience or Projects heading | high |
| Partial, but no Experience/Projects heading was recognised | medium |
| Missing | high (no alias appears anywhere) |
| Any match that relies only on an ambiguous word | low |

Version 1.0 also returned `similarityScore` (shown as "% context"). It measured wording overlap, not proficiency, and was
easy to misread, so 2.0 no longer returns or shows it. TF-IDF is still used internally to pick the evidence line.

## 6. Components and overall score

| Component | Base weight | Score (0–100) | Not scored when |
|---|---|---|---|
| Skill Match | 0.35 | Σ(weight × credit) / Σ weight; weight required 1 / preferred 0.5; credit strong 1, partial 0.5, missing 0 | JD has no recognised skills |
| Wording Similarity | 0.25 | TF-IDF cosine(full resume, full JD) × 100. Shared vocabulary, **not meaning**: synonyms don't count | never |
| Experience | 0.15 (× 0.5 if the years are only preferred) | min(1, resume years / JD years) × 100 | JD states no years |
| Education | 0.10 (× 0.5 if the degree is only preferred) | 100 if highest resume degree ≥ required level, else 0 | JD names no degree, **or** the JD accepts equivalent experience and no qualifying degree was found |
| Projects | 0.10 | weighted share of JD technical (non-soft) skills that appear in `projects` lines | JD has no technical skills |
| Certifications | 0.05 (× 0.5 if every certification is only preferred) | weighted share of JD certifications found in certification lines; a **course** line (course, Coursera, Udemy, bootcamp, training, …) without the word "certified/certification" does not count | JD never mentions certification |

The preferred multiplier reuses the same required/preferred weighting as skills; it is not a new constant.
"Wording Similarity" was called "Semantic Similarity" in 1.0, which overstated what TF-IDF does.

**Overall = Σ(score × base weight) / Σ(base weights of scored components)**, rounded to a **whole number**. Components
that can't be scored are listed in `notAssessed` and their weight is shared out over the rest. Each component reports
its renormalised `weight` and its `contribution` (score × weight, one decimal); the contributions add up to the
unrounded overall score, and the UI shows that sum and the rounding. Component scores keep one decimal in the data and
are shown as whole numbers.

The base weights come from the original frontend prototype's mock data, not from calibration.

### Component notes

- **Experience:** resume years = the larger of (a) date ranges in the Experience section, overlaps merged, `Present` =
  the analysis date, formats `Jan 2020`, `01/2020`, `2020`; and (b) an explicit "N years of experience" statement.
  Without an Experience heading, ranges from every section except Education and Certifications are used (confidence
  medium). Internships and part-time roles count in full; years with a specific skill are not checked. With **no dated
  roles at all**, the description asks for dates and the confidence is low instead of silently claiming zero years.
- **Education:** Diploma (1) < Bachelor's (2: B.Tech, B.E., B.Sc, BCA, …) < Master's (3: M.Tech, MS, MBA, MCA, …) < PhD (4).
  A degree marked *expected / pursuing / final year*, or with a future year, counts as meeting the level but is labelled
  **in progress** (confidence medium).
- **Job title:** `jdTitle` field if given; otherwise a `Job Title:/Position:/Role:` line; otherwise the first line if it
  is short and doesn't end with punctuation; otherwise "Target Role".

### Overall confidence

`confidence.level` is the lowest level among these reasons (high when none apply):

| Reason | Level |
|---|---|
| No skills recognised in the JD | low |
| No standard resume headings recognised | low |
| No Experience or Projects heading recognised | medium |
| Some skill matches rely on ambiguous words | medium |
| Some JD requirements recognised from ambiguous words | medium |
| A component has low confidence (e.g. no dated roles) | medium |

Confidence describes how clear the evidence is. It is not a probability and not a hiring prediction.

### TF-IDF (`tfidf.ts`)

Lowercase tokens (keeping `c++`, `c#`, `node.js`), a stop-word list, light suffix stripping (`-s`, `-ed`, `-ing`, `-ies`),
sublinear TF, smoothed IDF over the documents being compared, L2 normalisation.

## 7. "Why Not Me?" recommendations (`recommendations.ts`)

One recommendation per gap, with `priority`, `target`, `requirementType`, `group`, `whyItMatters`, `jdEvidence`,
`currentEvidence`, `gap`, `action`, `evidenceToAdd`, `impactPoints` and `impactNote`.

**Priority order:** required missing skills → required partial skills → required experience / education / certification
gaps → preferred missing skills → preferred partial skills → preferred background gaps. Within a group, larger impact
first, then name.

**Impact** is computed from the weights of this analysis, as whole overall-score points:
- missing or partial skill: `skillMatchWeight × skillWeight × (1 − credit) / totalSkillWeight`, plus, for a technical
  skill not yet in Projects, `projectsWeight × skillWeight / technicalSkillWeight` (the action suggests showing it in a
  project) → × 100, rounded;
- experience: `experienceWeight × (100 − experienceScore)`;
- education: `educationWeight × 100` (0 when equivalent experience is accepted, because that isn't scored);
- certification: `certificationsWeight × certWeight / totalCertWeight × 100`.

Wording Similarity would also change and is excluded, which the note says. Estimates below 1 point are shown as "< 1 pt".

Actions come from per-category templates (`build a small API service with FastAPI`) and a few per-skill ones
(`schedule a small data pipeline as an Airflow DAG`). They contain no invented employers, metrics or links. When a
related skill was found, the action first asks the candidate to name the real skill if they have used it.

The four legacy lists in `whyNotMe` (strengths, gaps, weakly supported, improvements) are still produced from the same
facts for older clients.

## 8. Career roadmap (`roadmap.ts`)

Generated on the server and stored with the result:
- order: required missing → required partial → preferred missing → preferred partial → **already strong** (collapsed in
  the UI);
- dependencies: `PREREQUISITES` in `skills.ts` (e.g. Kubernetes ← Docker, Linux; Next.js ← React). A prerequisite that
  is itself a gap is moved before the skill that needs it (`movedEarlierFor`); a prerequisite the resume already shows
  strongly is mentioned ("builds on Docker, which you already show"); one the resume doesn't mention at all is flagged
  as a possible starting point. Prerequisites never affect the score;
- steps per gap: **learn → build → demonstrate → document → re-analyse**, quoting the JD sentence;
- **no dates or durations** are generated.

## 9. Privacy mode (on by default; always on for guests)

Before saving, it replaces emails, phone numbers (10+ digits) and URLs in evidence with `[email]`, `[phone]` and
`[link]`, and stores the resume name as `resume.pdf` / `resume.docx`. The setting applies to new analyses only.

## 10. Career Assistant (`assistant/engine.ts`)

Intents, in order: a skill named in the analysis (rating, reason, confidence, JD sentence, resume evidence, next step
and impact) → confidence → score calculation (with contributions) → what to improve first (recommendations) → resume
advice (evidence to add) → learning path (roadmap) → what the JD asks for (requirements) → gaps → strengths → summary.
Every answer is assembled from stored fields; the "Sources" badges name them.

If `GEMINI_API_KEY` **and** `GEMINI_MODEL` are set, a signed-in user's rules answer and redacted analysis facts are sent to
Gemini to reword only (temperature 0.2, max 1,024 output tokens, 15 s timeout, 20 answers per user and 500 in total
per UTC day). The reply is validated (no new numbers, no changed ratings, no invented quotes, no links); anything else
falls back to the rules answer. See `SECURITY.md` (D-9). **Gemini cannot change a score, a rating or the evidence.**

The sample analysis assistant (`POST /api/demo/assistant`) is rules-only.

## 11. Sample analysis (`demo.ts`)

"Try Demo Analysis" and the homepage preview use `GET /api/demo/analysis`, which runs this engine live on a synthetic
resume ("Alex Rivera (synthetic sample)", example.com addresses) and a job description for a fictional company, with a
fixed analysis date of 2026-03-01 so years of experience don't drift. Nothing is hardcoded in the result, nothing is
stored, and the guest free analysis is not used. The documents were written so the sample shows every rating type,
related-skill notes, a course that isn't a certification and an in-progress degree.
