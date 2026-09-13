import { randomUUID } from "node:crypto";
import { anonymiseFilename, redactPII } from "./redact.js";
import { SECTION_LABEL, splitSections, type Line, type SectionName } from "./sections.js";
import { highestDegree, DEGREE_LEVELS, guessJobTitle, monthsFromDateRanges, requiredDegree, requiredYears, statedYears } from "./signals.js";
import { COMPILED_SKILLS, getSkill, mentionsSkill, skillCategory } from "./skills.js";
import { cosine, tfidfVectors } from "./tfidf.js";
import type { AnalysisResult, ScoreComponent, SkillLevel, SkillStatus } from "./types.js";

export const ENGINE_VERSION = "rules-tfidf-1.0";

/** Component weights, taken from the original Skill2Hire frontend prototype. See docs/SCORING.md. */
export const WEIGHTS = {
  skills: 0.35,
  semantic: 0.25,
  experience: 0.15,
  education: 0.1,
  projects: 0.1,
  certifications: 0.05,
} as const;

export const REQUIREMENT_WEIGHT = { required: 1, preferred: 0.5 } as const;
export const LEVEL_CREDIT: Record<SkillLevel, number> = { strong: 1, partial: 0.5, missing: 0 };

const DEMONSTRATED_SECTIONS: SectionName[] = ["experience", "projects"];
const ACTION_VERBS =
  /\b(built|build|developed|develop|designed|implemented|deployed|created|engineered|automated|optimi[sz]ed|migrated|architected|led|delivered|trained|integrated|launched|maintained|wrote|shipped|containeri[sz]ed|analy[sz]ed|improved|reduced|increased)\b/i;
const PREFERRED_CUE = /\b(preferred|nice[\s-]to[\s-]have|good[\s-]to[\s-]have|bonus|a\s+plus|is\s+a\s+plus|desirable|desired|advantage|optional|familiarity\s+with\s+.*\s+(is\s+)?a\s+plus)\b/i;
const PREFERRED_HEADING = /^(preferred|nice\s+to\s+have|good\s+to\s+have|bonus|desired|additional)\b/i;
const REQUIRED_HEADING = /^(required|requirements|must\s+have|minimum|basic|mandatory|qualifications|what\s+you('ll)?\s+need|responsibilities|key\s+skills)\b/i;

export interface AnalyzeInput {
  resumeText: string;
  jdText: string;
  resumeName: string;
  jdTitle?: string;
  privacyMode: boolean;
  now?: Date;
}

interface JdRequirement {
  skill: string;
  requirementType: "required" | "preferred";
  sentences: string[];
}

function jdSentences(jd: string): Array<{ text: string; preferred: boolean }> {
  const out: Array<{ text: string; preferred: boolean }> = [];
  let headingPreferred = false;
  for (const rawLine of jd.split("\n")) {
    const line = rawLine.replace(/^[•\-*\s]+/, "").trim();
    if (!line) continue;
    const headingText = line.replace(/[:\s]+$/, "");
    if (headingText.split(/\s+/).length <= 6 && (PREFERRED_HEADING.test(headingText) || REQUIRED_HEADING.test(headingText))) {
      headingPreferred = PREFERRED_HEADING.test(headingText);
      if (/:\s*$/.test(line) || headingText === line) continue;
    }
    for (const sentence of line.split(/(?<=[.;!?])\s+/)) {
      if (sentence.trim()) out.push({ text: sentence.trim(), preferred: headingPreferred || PREFERRED_CUE.test(sentence) });
    }
  }
  return out;
}

export function extractRequirements(jd: string): JdRequirement[] {
  const sentences = jdSentences(jd);
  const reqs: JdRequirement[] = [];
  for (const skill of COMPILED_SKILLS) {
    const hits = sentences.filter((s) => mentionsSkill(skill, s.text));
    if (!hits.length) continue;
    reqs.push({
      skill: skill.name,
      requirementType: hits.some((h) => !h.preferred) ? "required" : "preferred",
      sentences: hits.map((h) => h.text),
    });
  }
  return reqs;
}

function trimEvidence(text: string, privacy: boolean): string {
  const t = text.length > 220 ? text.slice(0, 217).trimEnd() + "..." : text;
  return privacy ? redactPII(t) : t;
}

export function analyze(input: AnalyzeInput): AnalysisResult {
  const { resumeText, jdText, privacyMode } = input;
  const now = input.now ?? new Date();
  const lines = splitSections(resumeText);
  const requirements = extractRequirements(jdText);
  const hasSection = (s: SectionName) => lines.some((l) => l.section === s);

  // ---- Per-skill evidence --------------------------------------------------------------------------------------
  const allJdSentences = requirements.flatMap((r) => r.sentences);
  const statuses: SkillStatus[] = requirements.map((req) => {
    const skill = getSkill(req.skill);
    const hits = lines.filter((l) => mentionsSkill(skill, l.text));
    const demonstrated = hits.filter(
      (l) => DEMONSTRATED_SECTIONS.includes(l.section) || (l.section === "other" && ACTION_VERBS.test(l.text))
    );
    const status: SkillLevel = demonstrated.length ? "strong" : hits.length ? "partial" : "missing";
    const importanceWeight = REQUIREMENT_WEIGHT[req.requirementType];
    if (status === "missing") return { skill: req.skill, status, requirementType: req.requirementType, importanceWeight };

    // Pick the evidence line whose wording is closest to what the JD says about this skill.
    const candidates = demonstrated.length ? demonstrated : hits;
    const vectors = tfidfVectors([...candidates.map((c) => c.text), req.sentences.join(" "), ...allJdSentences]);
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
    return {
      skill: req.skill,
      status,
      requirementType: req.requirementType,
      evidence: trimEvidence(best.text, privacyMode),
      similarityScore: Math.round(bestSim * 100),
      section: SECTION_LABEL[best.section],
      importanceWeight,
    };
  });

  const byWeight = (a: SkillStatus, b: SkillStatus) =>
    b.importanceWeight - a.importanceWeight || a.skill.localeCompare(b.skill);
  const strongSkills = statuses.filter((s) => s.status === "strong").sort(byWeight);
  const partialSkills = statuses.filter((s) => s.status === "partial").sort(byWeight);
  const missingSkills = statuses.filter((s) => s.status === "missing").sort(byWeight);

  // ---- Components ------------------------------------------------------------------------------------------------
  const components: Array<ScoreComponent & { rawWeight: number }> = [];
  const notAssessed: string[] = [];
  const pct = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 1000) / 10;

  const totalW = statuses.reduce((sum, s) => sum + s.importanceWeight, 0);
  if (totalW > 0) {
    const got = statuses.reduce((sum, s) => sum + s.importanceWeight * LEVEL_CREDIT[s.status], 0);
    const req = statuses.filter((s) => s.requirementType === "required");
    const reqCovered = req.filter((s) => s.status !== "missing").length;
    components.push({
      name: "Skill Match",
      score: pct(got / totalW),
      rawWeight: WEIGHTS.skills,
      weight: 0,
      description: `${strongSkills.length} strong, ${partialSkills.length} partial, ${missingSkills.length} missing of ${statuses.length} skills found in the JD` +
        (req.length ? ` (${reqCovered}/${req.length} required skills present).` : "."),
    });
  } else {
    notAssessed.push("Skill Match - no recognised skills in the job description");
  }

  const [resumeVec, jdVec] = tfidfVectors([resumeText, jdText]);
  const semantic = cosine(resumeVec, jdVec);
  components.push({
    name: "Semantic Similarity",
    score: pct(semantic),
    rawWeight: WEIGHTS.semantic,
    weight: 0,
    description: "TF-IDF cosine similarity between the full resume and job description wording.",
  });

  const needYears = requiredYears(jdText);
  if (needYears !== null && needYears > 0) {
    const expText = lines.filter((l) => l.section === "experience").map((l) => l.text).join("\n");
    const rangeYears = monthsFromDateRanges(expText || resumeText, now) / 12;
    const haveYears = Math.max(rangeYears, statedYears(resumeText) ?? 0);
    const rounded = Math.round(haveYears * 10) / 10;
    components.push({
      name: "Experience",
      score: pct(haveYears / needYears),
      rawWeight: WEIGHTS.experience,
      weight: 0,
      description:
        haveYears >= needYears
          ? `Meets the ${needYears}+ years asked for (about ${rounded} years detected).`
          : `JD asks for ${needYears}+ years; about ${rounded} years detected from dated roles.`,
    });
  } else {
    notAssessed.push("Experience - the job description states no years of experience");
  }

  const needDegree = requiredDegree(jdText);
  if (needDegree > 0) {
    const eduText = lines.filter((l) => l.section === "education").map((l) => l.text).join("\n");
    const have = highestDegree(eduText || resumeText);
    const meets = have >= needDegree;
    components.push({
      name: "Education",
      score: meets ? 100 : 0,
      rawWeight: WEIGHTS.education,
      weight: 0,
      description: meets
        ? `${DEGREE_LEVELS[have]} meets the ${DEGREE_LEVELS[needDegree]} requirement.`
        : have
          ? `${DEGREE_LEVELS[have]} detected; the JD asks for ${DEGREE_LEVELS[needDegree]}.`
          : `No degree detected; the JD asks for ${DEGREE_LEVELS[needDegree]}.`,
    });
  } else {
    notAssessed.push("Education - the job description states no degree requirement");
  }

  const technical = statuses.filter((s) => skillCategory(s.skill) !== "soft");
  if (technical.length) {
    const projectLines = lines.filter((l) => l.section === "projects");
    const inProjects = technical.filter((s) => projectLines.some((l) => mentionsSkill(getSkill(s.skill), l.text)));
    const w = technical.reduce((sum, s) => sum + s.importanceWeight, 0);
    const got = inProjects.reduce((sum, s) => sum + s.importanceWeight, 0);
    components.push({
      name: "Projects",
      score: pct(got / w),
      rawWeight: WEIGHTS.projects,
      weight: 0,
      description: projectLines.length
        ? `${inProjects.length} of ${technical.length} JD technical skills appear in your projects.`
        : "No Projects section detected in your resume.",
    });
  } else {
    notAssessed.push("Projects - no technical skills recognised in the job description");
  }

  const certSentences = jdText.split(/\n|(?<=[.;])\s+/).filter((s) => /certif/i.test(s));
  if (certSentences.length) {
    const certLines = lines.filter((l) => l.section === "certifications" || /certif/i.test(l.text));
    const wanted = COMPILED_SKILLS.filter((k) => certSentences.some((s) => mentionsSkill(k, s)));
    let score: number;
    let description: string;
    if (wanted.length) {
      const have = wanted.filter((k) => certLines.some((l) => mentionsSkill(k, l.text)));
      score = pct(have.length / wanted.length);
      description = `Certifications in ${have.map((k) => k.name).join(", ") || "none"} of the ${wanted.map((k) => k.name).join(", ")} areas the JD mentions.`;
    } else {
      score = certLines.length ? 100 : 0;
      description = certLines.length ? "Certifications listed; the JD mentions certifications." : "The JD mentions certifications but none were found.";
    }
    components.push({ name: "Certifications", score, rawWeight: WEIGHTS.certifications, weight: 0, description });
  } else {
    notAssessed.push("Certifications - the job description does not mention certifications");
  }

  // Renormalise weights over the components that could actually be assessed.
  const weightSum = components.reduce((s, c) => s + c.rawWeight, 0);
  const finalComponents: ScoreComponent[] = components.map(({ rawWeight, ...c }) => ({
    ...c,
    weight: Math.round((rawWeight / weightSum) * 1000) / 1000,
  }));
  const overall = components.reduce((s, c) => s + c.score * (c.rawWeight / weightSum), 0);

  // ---- Why not me (built only from the facts above) --------------------------------------------------------------
  const strengths = strongSkills.slice(0, 6).map((s) => `${s.skill} is demonstrated in your ${s.section} section`);
  for (const c of finalComponents) {
    if ((c.name === "Experience" || c.name === "Education") && c.score >= 100) strengths.push(c.description);
  }
  const reqMissing = missingSkills.filter((s) => s.requirementType === "required");
  const prefMissing = missingSkills.filter((s) => s.requirementType === "preferred");
  const gaps = [
    ...reqMissing.map((s) => `${s.skill} is required by the job description but not found in your resume`),
    ...prefMissing.map((s) => `${s.skill} (preferred) is not found in your resume`),
  ];
  for (const c of finalComponents) {
    if ((c.name === "Experience" || c.name === "Education") && c.score < 100) gaps.push(c.description);
  }
  const weakSupport = partialSkills.map(
    (s) => `${s.skill} only appears in your ${s.section} section, not in experience or project work`
  );
  const improvements = [
    ...reqMissing.slice(0, 4).map((s) => `Build and document a project that uses ${s.skill}`),
    ...partialSkills.slice(0, 4).map((s) => `Add an experience or project bullet showing how you used ${s.skill}`),
  ];
  if (!hasSection("projects") && technical.length) improvements.push("Add a Projects section that names the technologies you used");
  const certComp = finalComponents.find((c) => c.name === "Certifications");
  if (certComp && certComp.score < 100) improvements.push("Consider a certification in an area the job description mentions");

  return {
    id: randomUUID(),
    overallScore: Math.round(overall * 10) / 10,
    components: finalComponents,
    notAssessed,
    strongSkills,
    partialSkills,
    missingSkills,
    whyNotMe: { strengths, gaps, weakSupport, improvements },
    resumeName: privacyMode ? anonymiseFilename(input.resumeName) : input.resumeName,
    jdTitle: (input.jdTitle?.trim() || guessJobTitle(jdText)).slice(0, 120),
    analyzedAt: now.toISOString(),
    engineVersion: ENGINE_VERSION,
  };
}
