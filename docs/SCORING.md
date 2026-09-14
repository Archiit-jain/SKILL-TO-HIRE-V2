# How Scoring Works

Engine version: `rules-tfidf-1.0` (`server/src/analysis/`). It is fully deterministic: the same inputs always give the
same result. No machine-learning model is trained or downloaded.

> **Accuracy has not been evaluated** on a labelled dataset of real resumes and job descriptions. The rules and
> weights below are a transparent baseline, not a validated hiring predictor. See [DECISIONS.md](DECISIONS.md).

## 1. Text extraction (`extract.ts`)

| Input | Parser | Limits |
|---|---|---|
| PDF | `pdf-parse` 2.4.5 (pdf.js 5.4.296, `isEvalSupported: false`) | First 20 pages; pre-scan: no encryption, allowed filters only, Flate ≤ 10 MB per stream / 30 MB total (see `SECURITY.md`) |
| DOCX | `mammoth` 1.12.3 raw text | Guard: ≤ 2,000 entries, ≤ 20 MB declared, XML parts ≤ 4 MB each and in total, real sizes + CRC verified (see `SECURITY.md`) |
| TXT (JD only) | strict UTF-8 decode | No NUL bytes |

The text is normalised (line endings, control characters, bullet glyphs, whitespace) and capped at 100,000 characters.
A resume needs at least 50 characters of text, and so does a JD. Scanned PDFs without a text layer are rejected.

## 2. Resume sections (`sections.ts`)

Lines of five words or fewer that match a known heading switch the current section:
`summary`, `skills`, `experience`, `projects`, `education`, `certifications`. Lines before any heading are `other`
(shown as "General").

## 3. Skill dictionary (`skills.ts`)

About 140 curated skills in 14 categories, each with aliases (e.g. Kubernetes ← `K8s`, `kubectl`, `Helm`, `EKS`).
Matching uses token boundaries that handle `C++`, `C#`, `.NET` and `Node.js`.

- Aliases that are also ordinary English words (`Excel`, `Swift`, `Rust`, `REST`, `Spark`, `Angular`, …) only match
  with exact casing.
- `C`, `R` and `Go` only match through unambiguous phrasings (`C programming`, `RStudio`, `Golang`, `C/C++`).
- Only skills in the dictionary are recognised. **Add missing technologies there.**

## 4. JD requirements (`analyze.ts → extractRequirements`)

A skill is a requirement if it appears in any JD sentence. It is **preferred** only if every mention is preferred:
- the sentence is under a heading such as *Preferred*, *Nice to have*, *Bonus*, *Desired*, or
- the sentence has a cue: *preferred, nice to have, good to have, bonus, a plus, desirable, advantage, optional*.

Otherwise it is **required**. Importance weight: required = **1.0**, preferred = **0.5**.

## 5. Skill status

For each JD skill, find the resume lines that mention it:

| Status | Rule |
|---|---|
| **Strong** | Mentioned in an `experience` or `projects` line, or in an unsectioned line with an action verb (built, developed, deployed, …) |
| **Partial** | Mentioned only elsewhere (skills list, summary, education, certifications) |
| **Missing** | Not mentioned anywhere |

**Evidence** is the qualifying line whose TF-IDF vector is closest to the JD sentences about that skill, trimmed to
220 characters. **`similarityScore`** ("% context" in the UI) is that cosine similarity × 100. It measures wording
overlap between the evidence and the JD, not skill proficiency, and it does not change the status.

## 6. Components and overall score

| Component | Base weight | Score (0–100) | Skipped when |
|---|---|---|---|
| Skill Match | 0.35 | Σ(weight × credit) / Σ weight, credit: strong 1, partial 0.5, missing 0 | JD has no recognised skills |
| Semantic Similarity | 0.25 | TF-IDF cosine(full resume, full JD) × 100 | never |
| Experience | 0.15 | min(1, resume years / JD minimum years) × 100 | JD states no years |
| Education | 0.10 | 100 if highest resume degree ≥ lowest degree the JD names, else 0 | JD names no degree |
| Projects | 0.10 | weighted share of JD technical (non-soft) skills that appear in `projects` lines | JD has no technical skills |
| Certifications | 0.05 | share of JD cert-sentence skills found in resume certification lines (or 100/0 if the JD names no specific area) | JD never mentions certification |

**Overall = Σ(score × base weight) / Σ(base weights of assessed components).** Skipped components are listed in
`notAssessed` and their weight is redistributed, so a JD that doesn't mention a degree doesn't penalise anyone. The
weights shown in the UI are the renormalised ones.

The base weights come from the original frontend prototype's mock data, not from calibration.

### Signal details (`signals.ts`)

- **JD years:** first match of `N+ years … experience` / `N-M years experience` (the minimum is used).
- **Resume years:** the larger of (a) the total of date ranges in the Experience section, with overlaps merged,
  `Present` = today, formats `Jan 2020`, `01/2020`, `2020`; and (b) an explicit "N years of experience" statement.
  Without an Experience section, ranges across the whole resume are used, which can include education dates.
- **Degrees:** Diploma (1) < Bachelor's (2: B.Tech, B.E., B.Sc, BCA, …) < Master's (3: M.Tech, MS, MBA, MCA, …) < PhD (4).
- **Job title:** `jdTitle` field if given; otherwise a `Job Title:/Position:/Role:` line; otherwise the first line
  if it is short and doesn't end with punctuation; otherwise "Target Role".

### TF-IDF (`tfidf.ts`)

Lowercase tokens (keeping `c++`, `c#`, `node.js`), a stop-word list, light suffix stripping (`-s`, `-ed`, `-ing`,
`-ies`), sublinear TF, smoothed IDF over the documents being compared, L2 normalisation.

## 7. "Why Not Me?"

Built only from the facts above:
- **Strengths:** strong skills with their section, plus Experience/Education components that scored 100.
- **Gaps:** missing required skills, then missing preferred skills, then Experience/Education shortfalls.
- **Weakly supported:** partial skills and the section they appear in.
- **Improvements:** a project for up to 4 missing required skills, a bullet for up to 4 partial skills, a Projects
  section if there is none, a certification if that component scored below 100.

## 8. Privacy mode (on by default)

Before saving, it replaces emails, phone numbers (10+ digits) and URLs in evidence with `[email]`, `[phone]` and
`[link]`, and stores the resume name as `resume.pdf` / `resume.docx`. The setting applies to new analyses only.

## 9. Career Assistant (`assistant/engine.ts`)

It matches the question against intents in this order: a skill named in the analysis → score explanation → what to
improve first → resume advice → learning path → gaps → strengths → summary. Each answer is assembled from stored
analysis fields, and the "Sources" badges name those fields.

If `GEMINI_API_KEY` **and** `GEMINI_MODEL` are set, the rule-based answer and a compact JSON of the analysis are sent
to Gemini with instructions to rephrase only those facts, never change numbers or ratings, and treat the question
as data. Settings: temperature 0.2, max 600 output tokens, 15 s timeout. Any error falls back to the rule-based answer.

## 10. Roadmap (frontend, `RoadmapPage.tsx`)

Ordered by impact: missing required (high) → missing preferred (medium) → partial (medium) → strong (low, maintain).
No learning-resource links are generated, because none have been approved (see DECISIONS.md).
