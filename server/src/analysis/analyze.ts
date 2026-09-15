import { randomUUID } from "node:crypto";
import { buildRecommendations, legacyWhyNotMe } from "./recommendations.js";
import { anonymiseFilename, redactPII } from "./redact.js";
import { decomposeJd, lowerConfidence, trimSentence } from "./requirements.js";
import { buildRoadmap } from "./roadmap.js";
import { SECTION_LABEL, splitSections, type Line, type SectionName } from "./sections.js";
import { highestDegree, DEGREE_LEVELS, guessJobTitle, monthsFromDateRanges, statedYears } from "./signals.js";
import { findSkills, getSkill, isAmbiguousMention, mentionsSkill, RELATED, skillCategory } from "./skills.js";
import { cosine, tfidfVectors } from "./tfidf.js";
import { LEVEL_CREDIT, REQUIREMENT_WEIGHT, WEIGHTS } from "./weights.js";
import type { AnalysisResult, ComponentKey, Confidence, RelatedEvidence, ScoreComponent, SkillLevel, SkillStatus } from "./types.js";

export const ENGINE_VERSION = "rules-tfidf-2.0";

export { LEVEL_CREDIT, REQUIREMENT_WEIGHT, WEIGHTS } from "./weights.js";

const DEMONSTRATED_SECTIONS: SectionName[] = ["experience", "projects"];
export const ACTION_VERBS =
  /\b(built|build|developed|develop|designed|implemented|deployed|created|engineered|automated|optimi[sz]ed|migrated|architected|led|delivered|trained|integrated|launched|maintained|wrote|shipped|containeri[sz]ed|analy[sz]ed|improved|reduced|increased|scheduled|configured|tested|modelled|modeled|visuali[sz]ed|processed|managed|published|packaged|explained|presented|mentored|coordinated|collaborated)\b/i;
const COURSE_ONLY = /\b(course|coursework|coursera|udemy|edx|bootcamp|training|workshop|mooc|nptel|tutorial)\b/i;
const IN_PROGRESS = /\b(expected|pursuing|present|ongoing|in\s+progress|currently|final[\s-]year|anticipated)\b/i;

export interface AnalyzeInput {
  resumeText: string;
  jdText: string;
  resumeName: string;
  jdTitle?: string;
  privacyMode: boolean;
  now?: Date;
}

/** Skill requirements as {skill, requirementType, sentences}; kept for callers and tests of the JD parser. */
export function extractRequirements(jd: string) {
  return decomposeJd(jd).skills.map((r) => ({ skill: r.skill, requirementType: r.requirementType, jdEvidence: r.jdEvidence }));
}

const round1 = (x: number) => Math.round(x * 10) / 10;
const yearsText = (n: number) => `${n} year${n === 1 ? "" : "s"}`;
const pct = (x: number) => round1(Math.max(0, Math.min(1, x)) * 100);

export function analyze(input: AnalyzeInput): AnalysisResult {
  const { resumeText, jdText, privacyMode } = input;
  const now = input.now ?? new Date();
  const lines = splitSections(resumeText);
  const jd = decomposeJd(jdText);
  const hasSection = (s: SectionName) => lines.some((l) => l.section === s);
  const clean = (text: string) => {
    const t = trimSentence(text);
    return privacyMode ? redactPII(t) : t;
  };
  const appliedSectionsFound = hasSection("experience") || hasSection("projects");

  // ---- Per-skill evidence --------------------------------------------------------------------------------------
  const allJdSentences = jd.skills.map((r) => r.jdEvidence);
  const statuses: SkillStatus[] = jd.skills.map((req) => {
    const skill = getSkill(req.skill);
    const hits = lines.filter((l) => mentionsSkill(skill, l.text));
    const demonstrated = hits.filter(
      (l) => DEMONSTRATED_SECTIONS.includes(l.section) || (l.section === "other" && ACTION_VERBS.test(l.text))
    );
    const status: SkillLevel = demonstrated.length ? "strong" : hits.length ? "partial" : "missing";
    const importanceWeight = REQUIREMENT_WEIGHT[req.requirementType];
    const base = { skill: req.skill, status, requirementType: req.requirementType, category: req.category, jdEvidence: req.jdEvidence, importanceWeight };

    if (status === "missing") {
      const related = relatedEvidence(req.skill, lines, clean);
      const reason =
        "Not found anywhere in your resume." +
        (related.length ? ` Related evidence isn't counted: ${related.map((r) => r.note).join(" ")}` : "");
      return { ...base, reason, confidence: "high", related };
    }

    // Pick the evidence line whose wording is closest to what the JD says about this skill.
    const candidates = demonstrated.length ? demonstrated : hits;
    const vectors = tfidfVectors([...candidates.map((c) => c.text), req.jdEvidence, ...allJdSentences]);
    const jdVec = vectors[candidates.length];
    let best: Line = candidates[0];
    let bestSim = -1;
    candidates.forEach((c, i) => {
      const sim = cosine(vectors[i], jdVec);
      if (sim > bestSim) {
        bestSim = sim;
        best = c;
      }
    });
    const section = SECTION_LABEL[best.section];

    let reason: string;
    let confidence: Confidence;
    if (status === "strong") {
      if (best.section === "other") {
        reason = `Found in an action statement outside a recognised Experience or Projects heading, so it counts as applied use.`;
        confidence = "medium";
      } else if (ACTION_VERBS.test(best.text)) {
        reason = `Used in your ${section} section, in a line that says what you did with it.`;
        confidence = "high";
      } else {
        reason = `Named in your ${section} section, but the line doesn't say what you did with it.`;
        confidence = "medium";
      }
    } else {
      reason = `Only listed in your ${section} section; no Experience or Projects line shows it in use.`;
      confidence = "high";
      if (!appliedSectionsFound) {
        reason += " No Experience or Projects heading was recognised in your resume, so applied use may have been missed.";
        confidence = "medium";
      }
    }
    if (candidates.every((c) => isAmbiguousMention(skill, c.text))) {
      reason += ` The match relies on a word that can also be ordinary English, so check that it really refers to ${req.skill}.`;
      confidence = "low";
    }
    return { ...base, evidence: clean(best.text), section, reason, confidence, related: [] };
  });

  const byWeight = (a: SkillStatus, b: SkillStatus) => b.importanceWeight - a.importanceWeight || a.skill.localeCompare(b.skill);
  const strongSkills = statuses.filter((s) => s.status === "strong").sort(byWeight);
  const partialSkills = statuses.filter((s) => s.status === "partial").sort(byWeight);
  const missingSkills = statuses.filter((s) => s.status === "missing").sort(byWeight);

  // ---- Components ------------------------------------------------------------------------------------------------
  type Draft = Omit<ScoreComponent, "weight" | "contribution"> & { rawWeight: number };
  const components: Draft[] = [];
  const notAssessed: string[] = [];

  const totalW = statuses.reduce((sum, s) => sum + s.importanceWeight, 0);
  if (totalW > 0) {
    const got = statuses.reduce((sum, s) => sum + s.importanceWeight * LEVEL_CREDIT[s.status], 0);
    const req = statuses.filter((s) => s.requirementType === "required");
    const reqCovered = req.filter((s) => s.status !== "missing").length;
    const lowCount = statuses.filter((s) => s.confidence === "low").length;
    components.push({
      key: "skills",
      name: "Skill Match",
      score: pct(got / totalW),
      rawWeight: WEIGHTS.skills,
      description:
        `${strongSkills.length} strong, ${partialSkills.length} partial, ${missingSkills.length} missing of ${statuses.length} skills found in the job description` +
        (req.length ? ` (${reqCovered} of ${req.length} required skills present).` : ".") +
        " Required skills count double; Strong earns full credit, Partial half.",
      confidence: lowCount ? "medium" : "high",
    });
  } else {
    notAssessed.push("Skill Match - no skills from Skill2Hire's skill list were recognised in the job description");
  }

  const [resumeVec, jdVec] = tfidfVectors([resumeText, jdText]);
  components.push({
    key: "wording",
    name: "Wording Similarity",
    score: pct(cosine(resumeVec, jdVec)),
    rawWeight: WEIGHTS.wording,
    description:
      "TF-IDF cosine similarity between the words in your resume and the job description. It measures shared vocabulary, not meaning, so synonyms don't count.",
    confidence: "medium",
  });

  let experienceGap: { needYears: number; haveYears: number; datesFound: boolean } | null = null;
  if (jd.experience) {
    const need = jd.experience.years;
    const experienceLines = lines.filter((l) => l.section === "experience");
    // Without an Experience heading, date ranges from everything except Education/Certifications are used.
    const datedText = (experienceLines.length ? experienceLines : lines.filter((l) => l.section !== "education" && l.section !== "certifications"))
      .map((l) => l.text)
      .join("\n");
    const rangeYears = monthsFromDateRanges(datedText, now) / 12;
    const stated = statedYears(resumeText);
    const haveYears = Math.max(rangeYears, stated ?? 0);
    const rounded = round1(haveYears);
    const datesFound = rangeYears > 0 || stated !== null;
    const preferred = jd.experience.requirementType === "preferred" ? " (preferred)" : "";
    let description: string;
    let confidence: Confidence;
    if (!datesFound) {
      description = `The job description asks for ${need}+ years${preferred}, but no dated roles were found. Add start and end dates (for example Jan 2024 - Jun 2024) to each role.`;
      confidence = "low";
    } else {
      description =
        (haveYears >= need
          ? `Meets the ${need}+ years asked for${preferred} (about ${yearsText(rounded)} detected).`
          : `The job description asks for ${need}+ years${preferred}; about ${yearsText(rounded)} detected from dated roles.`) +
        " Internships and part-time roles count in full; years with a specific skill aren't checked.";
      confidence = experienceLines.length ? "high" : "medium";
    }
    components.push({
      key: "experience",
      name: "Experience",
      score: pct(haveYears / need),
      rawWeight: WEIGHTS.experience * REQUIREMENT_WEIGHT[jd.experience.requirementType],
      description,
      confidence,
    });
    if (haveYears < need) experienceGap = { needYears: need, haveYears: rounded, datesFound };
  } else {
    notAssessed.push("Experience - the job description states no years of experience");
  }

  let educationGap: { needed: string; have: string | null; equivalentAccepted: boolean } | null = null;
  if (jd.education) {
    const need = jd.education.level;
    const eduLines = lines.filter((l) => l.section === "education");
    const eduText = (eduLines.length ? eduLines.map((l) => l.text) : lines.map((l) => l.text)).join("\n");
    const have = highestDegree(eduText);
    const degreeLine = (eduLines.length ? eduLines : lines).find((l) => highestDegree(l.text) === have && have > 0)?.text ?? "";
    const futureYear = [...degreeLine.matchAll(/\b(?:19|20)\d{2}\b/g)].some((m) => Number(m[0]) > now.getFullYear());
    const inProgress = have > 0 && (IN_PROGRESS.test(degreeLine) || futureYear);
    const field = jd.education.fieldMentioned ? " The field of study isn't checked." : "";
    const preferred = jd.education.requirementType === "preferred" ? " (preferred)" : "";
    if (have >= need) {
      components.push({
        key: "education",
        name: "Education",
        score: 100,
        rawWeight: WEIGHTS.education * REQUIREMENT_WEIGHT[jd.education.requirementType],
        description:
          `${DEGREE_LEVELS[have]} degree detected, which meets the ${DEGREE_LEVELS[need]} requirement${preferred}` +
          (inProgress ? ", counted as in progress (it depends on completing the degree)." : ".") +
          field,
        confidence: inProgress || !eduLines.length ? "medium" : "high",
      });
    } else if (jd.education.equivalentAccepted) {
      notAssessed.push(
        `Education - the job description accepts equivalent experience instead of a ${DEGREE_LEVELS[need]}, which a resume alone can't verify`
      );
      educationGap = { needed: DEGREE_LEVELS[need], have: have ? DEGREE_LEVELS[have] : null, equivalentAccepted: true };
    } else {
      components.push({
        key: "education",
        name: "Education",
        score: 0,
        rawWeight: WEIGHTS.education * REQUIREMENT_WEIGHT[jd.education.requirementType],
        description:
          (have ? `${DEGREE_LEVELS[have]} detected; the job description asks for a ${DEGREE_LEVELS[need]}${preferred}.` : `No degree detected; the job description asks for a ${DEGREE_LEVELS[need]}${preferred}.`) +
          field,
        confidence: eduLines.length ? "high" : "medium",
      });
      educationGap = { needed: DEGREE_LEVELS[need], have: have ? DEGREE_LEVELS[have] : null, equivalentAccepted: false };
    }
  } else {
    notAssessed.push("Education - the job description states no degree requirement");
  }

  const technical = statuses.filter((s) => skillCategory(s.skill) !== "soft");
  const projectLines = lines.filter((l) => l.section === "projects");
  const inProjects = new Set(technical.filter((s) => projectLines.some((l) => mentionsSkill(getSkill(s.skill), l.text))).map((s) => s.skill));
  if (technical.length) {
    const w = technical.reduce((sum, s) => sum + s.importanceWeight, 0);
    const got = technical.filter((s) => inProjects.has(s.skill)).reduce((sum, s) => sum + s.importanceWeight, 0);
    components.push({
      key: "projects",
      name: "Projects",
      score: pct(got / w),
      rawWeight: WEIGHTS.projects,
      description: projectLines.length
        ? `${inProjects.size} of ${technical.length} technical skills from the job description appear in your Projects section.`
        : "No Projects section detected in your resume.",
      confidence: "high",
    });
  } else {
    notAssessed.push("Projects - no technical skills recognised in the job description");
  }

  const certGaps: Array<{ skill: string | null; courseOnly: boolean; requirementType: "required" | "preferred"; jdEvidence: string }> = [];
  if (jd.certifications.length) {
    const certLines = lines.filter((l) => l.section === "certifications" || /certif/i.test(l.text));
    const isCourseOnly = (l: Line) => COURSE_ONLY.test(l.text) && !/certif/i.test(l.text);
    let got = 0;
    let total = 0;
    const earned: string[] = [];
    const courseNotes: string[] = [];
    for (const req of jd.certifications) {
      const w = REQUIREMENT_WEIGHT[req.requirementType];
      total += w;
      const matching = req.skill ? certLines.filter((l) => mentionsSkill(getSkill(req.skill!), l.text)) : certLines;
      const real = matching.filter((l) => !isCourseOnly(l));
      if (real.length) {
        got += w;
        earned.push(req.label);
      } else {
        const courseOnly = matching.length > 0;
        if (courseOnly) courseNotes.push(`${req.skill ?? "Your certification entry"} appears as a course, which isn't counted as a certification.`);
        certGaps.push({ skill: req.skill, courseOnly, requirementType: req.requirementType, jdEvidence: req.jdEvidence });
      }
    }
    const allPreferred = jd.certifications.every((c) => c.requirementType === "preferred");
    components.push({
      key: "certifications",
      name: "Certifications",
      score: pct(got / total),
      rawWeight: WEIGHTS.certifications * (allPreferred ? REQUIREMENT_WEIGHT.preferred : REQUIREMENT_WEIGHT.required),
      description:
        `${earned.length} of ${jd.certifications.length} certification${jd.certifications.length === 1 ? "" : "s"} the job description mentions found` +
        (earned.length ? ` (${earned.join(", ")}).` : ".") +
        (courseNotes.length ? ` ${courseNotes.join(" ")}` : ""),
      confidence: hasSection("certifications") ? "high" : "medium",
    });
  } else {
    notAssessed.push("Certifications - the job description does not mention certifications");
  }

  // Renormalise weights over the components that could actually be assessed.
  const weightSum = components.reduce((s, c) => s + c.rawWeight, 0);
  const finalComponents: ScoreComponent[] = components.map(({ rawWeight, ...c }) => ({
    ...c,
    weight: Math.round((rawWeight / weightSum) * 1000) / 1000,
    contribution: round1((c.score * rawWeight) / weightSum),
  }));
  const overall = components.reduce((s, c) => s + c.score * (c.rawWeight / weightSum), 0);
  const weightOf = (key: ComponentKey) => {
    const c = components.find((x) => x.key === key);
    return c ? c.rawWeight / weightSum : 0;
  };

  // ---- Confidence --------------------------------------------------------------------------------------------------
  const reasons: Array<{ level: Confidence; text: string }> = [];
  if (!statuses.length) reasons.push({ level: "low", text: "No skills from Skill2Hire's skill list were recognised in the job description, so the score rests on wording and background checks only." });
  const recognisedSections = (["experience", "projects", "skills", "education"] as SectionName[]).filter(hasSection);
  if (!recognisedSections.length) {
    reasons.push({ level: "low", text: "No standard resume headings (Experience, Projects, Skills, Education) were recognised, so where each skill appears is uncertain." });
  } else if (!appliedSectionsFound) {
    reasons.push({ level: "medium", text: "No Experience or Projects heading was recognised, so applied use of skills may have been missed." });
  }
  const lowSkills = statuses.filter((s) => s.confidence === "low").map((s) => s.skill);
  if (lowSkills.length) reasons.push({ level: "medium", text: `Some matches rely on words that can also be ordinary English: ${lowSkills.join(", ")}.` });
  const lowReqs = jd.skills.filter((r) => r.confidence === "low").map((r) => r.skill);
  if (lowReqs.length) reasons.push({ level: "medium", text: `Some job description requirements were recognised from ambiguous words: ${lowReqs.join(", ")}.` });
  for (const c of finalComponents) if (c.confidence === "low") reasons.push({ level: "medium", text: `${c.name}: ${c.description}` });
  const level = reasons.reduce<Confidence>((acc, r) => lowerConfidence(acc, r.level), "high");
  const confidence = {
    level,
    reasons: reasons.length
      ? reasons.map((r) => r.text)
      : ["Standard resume sections were recognised and every rating is backed by direct evidence or its clear absence."],
  };

  const resumeSkills = findSkills(resumeText);
  const recommendations = buildRecommendations({
    statuses,
    totalSkillWeight: totalW,
    technicalWeight: technical.reduce((sum, s) => sum + s.importanceWeight, 0),
    inProjects,
    weightOf,
    experience: jd.experience && experienceGap ? { ...experienceGap, requirement: jd.experience, score: components.find((c) => c.key === "experience")!.score } : null,
    education: jd.education && educationGap ? { ...educationGap, requirement: jd.education } : null,
    certifications: certGaps,
    certificationTotalWeight: jd.certifications.reduce((s, c) => s + REQUIREMENT_WEIGHT[c.requirementType], 0),
  });

  return {
    id: randomUUID(),
    overallScore: Math.round(overall),
    components: finalComponents,
    notAssessed,
    requirements: jd.all,
    strongSkills,
    partialSkills,
    missingSkills,
    confidence,
    recommendations,
    roadmap: buildRoadmap(statuses, resumeSkills),
    whyNotMe: legacyWhyNotMe(strongSkills, partialSkills, missingSkills, finalComponents, recommendations),
    resumeName: privacyMode ? anonymiseFilename(input.resumeName) : input.resumeName,
    jdTitle: (input.jdTitle?.trim() || guessJobTitle(jdText)).slice(0, 120),
    analyzedAt: now.toISOString(),
    engineVersion: ENGINE_VERSION,
  };
}

/** Related-but-different skills found in the resume for a missing skill. Shown for context; never scored. */
function relatedEvidence(skill: string, lines: Line[], clean: (t: string) => string): RelatedEvidence[] {
  const out: RelatedEvidence[] = [];
  for (const rel of RELATED[skill] ?? []) {
    const hits = lines.filter((l) => mentionsSkill(getSkill(rel.skill), l.text));
    if (!hits.length) continue;
    const best = hits.find((l) => DEMONSTRATED_SECTIONS.includes(l.section)) ?? hits[0];
    out.push({ skill: rel.skill, section: SECTION_LABEL[best.section], evidence: clean(best.text), note: `${rel.skill} ${rel.note}.` });
  }
  return out;
}
