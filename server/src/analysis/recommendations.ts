import type { EducationRequirement, ExperienceRequirement } from "./requirements.js";
import { skillCategory, type SkillCategory } from "./skills.js";
import type { ComponentKey, Recommendation, RequirementType, ScoreComponent, SkillStatus } from "./types.js";
import { LEVEL_CREDIT, REQUIREMENT_WEIGHT } from "./weights.js";

/**
 * "Why not me" recommendations, built only from the analysis facts. The impact estimate uses the same weights as the
 * score: it is the number of overall points the gap is worth, not a promise of what an employer will think.
 */


/** A way to practise and show a skill, by category. Templates only: no invented employers, numbers or links. */
const PRACTICE_BY_CATEGORY: Record<SkillCategory, (skill: string) => string> = {
  language: (s) => `build a small tool or script in ${s}`,
  frontend: (s) => `build a small web interface with ${s}`,
  backend: (s) => `build a small API service with ${s}`,
  database: (s) => `design a small ${s} database and write realistic queries against it`,
  cloud: (s) => `deploy one of your projects on ${s}`,
  devops: (s) => `automate the build or deployment of one of your projects with ${s}`,
  data: (s) => `build a small data pipeline or analysis with ${s} on a public dataset`,
  ai_ml: (s) => `train and evaluate a small model with ${s} on a public dataset`,
  mobile: (s) => `build a small mobile app with ${s}`,
  testing: (s) => `write ${s} tests for one of your existing projects`,
  tools: (s) => `use ${s} throughout one of your own projects`,
  security: (s) => `add ${s} to one of your projects`,
  practice: (s) => `apply ${s} in a project and explain how`,
  soft: (s) => `use ${s} in a team project, club role or internship task`,
};

/** Skills whose category template doesn't fit. */
const PRACTICE_BY_SKILL: Record<string, string> = {
  Docker: "package one of your projects as a Docker image and run it",
  Kubernetes: "deploy one of your containerised projects on a local Kubernetes cluster",
  Git: "keep one of your projects in Git with clear, regular commits and branches",
  Airflow: "schedule a small data pipeline as an Airflow DAG",
  Terraform: "define the infrastructure for one of your projects with Terraform",
  "CI/CD": "set up a pipeline that tests and deploys one of your projects automatically",
  Linux: "run and administer one of your projects on a Linux machine",
};

/** What to do to practise and show a skill, as a verb phrase ("build a small API service with FastAPI"). */
export const practiceFor = (skill: string) => PRACTICE_BY_SKILL[skill] ?? PRACTICE_BY_CATEGORY[skillCategory(skill) ?? "practice"](skill);

/**
 * Priority order: required missing skills, required partial skills, required experience/education/certification gaps,
 * then the same for preferred requirements. Within a group, the larger estimated impact comes first.
 */
const rankOf = (r: Omit<Recommendation, "priority">) =>
  r.group === "other"
    ? r.requirementType === "required"
      ? 2
      : 5
    : { "required-missing": 0, "required-partial": 1, "preferred-missing": 3, "preferred-partial": 4 }[r.group];

export interface RecommendationInput {
  statuses: SkillStatus[];
  totalSkillWeight: number;
  technicalWeight: number;
  inProjects: Set<string>;
  /** Normalised weight of a component in this analysis (0 when not assessed). */
  weightOf: (key: ComponentKey) => number;
  experience: { requirement: ExperienceRequirement; needYears: number; haveYears: number; datesFound: boolean; score: number } | null;
  education: { requirement: EducationRequirement; needed: string; have: string | null; equivalentAccepted: boolean } | null;
  certifications: Array<{ skill: string | null; courseOnly: boolean; requirementType: RequirementType; jdEvidence: string }>;
  certificationTotalWeight: number;
}

const points = (x: number) => Math.max(0, Math.round(x));

function impactText(n: number, parts: string[]): string {
  const where = parts.join(" and ");
  if (n === 0) return `Less than 1 point on its own (${where}), but it still closes a gap the job description names.`;
  return `About +${n} point${n === 1 ? "" : "s"} to your overall score (${where}). Wording Similarity may also change.`;
}

export function buildRecommendations(input: RecommendationInput): Recommendation[] {
  const recs: Omit<Recommendation, "priority">[] = [];

  for (const s of input.statuses) {
    if (s.status === "strong") continue;
    const group = `${s.requirementType}-${s.status}` as Recommendation["group"];
    const technical = skillCategory(s.skill) !== "soft";
    const skillGain = input.totalSkillWeight ? (input.weightOf("skills") * s.importanceWeight * (1 - LEVEL_CREDIT[s.status])) / input.totalSkillWeight : 0;
    const projectGain =
      technical && !input.inProjects.has(s.skill) && input.technicalWeight ? (input.weightOf("projects") * s.importanceWeight) / input.technicalWeight : 0;
    const impactPoints = points((skillGain + projectGain) * 100);
    const parts = ["Skill Match", ...(projectGain > 0 ? ["Projects, if shown in a project"] : [])];
    const related = s.related.map((r) => r.skill);
    const typeLabel = s.requirementType === "required" ? "a required" : "a preferred";

    if (s.status === "missing") {
      recs.push({
        kind: "skill",
        target: s.skill,
        requirementType: s.requirementType,
        group,
        whyItMatters: `The job description lists ${s.skill} as ${typeLabel} skill.`,
        jdEvidence: s.jdEvidence,
        currentEvidence: s.related[0] ? s.related[0].evidence : null,
        gap: related.length
          ? `${s.skill} isn't in your resume. You mention ${related.join(", ")}, which is related but not the same skill.`
          : `${s.skill} isn't mentioned anywhere in your resume.`,
        action: related.length
          ? `If you have really used ${s.skill}, name it explicitly where you describe that work. If not, learn it, then ${practiceFor(s.skill)}.`
          : technical
            ? `Learn ${s.skill}, then ${practiceFor(s.skill)}.`
            : `Find a chance to ${practiceFor(s.skill)}.`,
        evidenceToAdd: technical
          ? `A Projects or Experience bullet that names ${s.skill} and says what you did with it, e.g. "<Action verb> <what> with ${s.skill}, <result>".`
          : `An Experience or Projects bullet that shows ${s.skill} in action, e.g. "<situation> - <what you did> - <result>".`,
        impactPoints,
        impactNote: impactText(impactPoints, parts),
      });
    } else {
      recs.push({
        kind: "skill",
        target: s.skill,
        requirementType: s.requirementType,
        group,
        whyItMatters: `The job description lists ${s.skill} as ${typeLabel} skill, and listing it isn't the same as showing it in use.`,
        jdEvidence: s.jdEvidence,
        currentEvidence: s.evidence ?? null,
        gap: `${s.skill} only appears in your ${s.section ?? "resume"} section; no Experience or Projects line shows it in use.`,
        action: technical
          ? `Describe a real task where you used ${s.skill} in an Experience or Projects bullet. If there isn't one yet, ${practiceFor(s.skill)}.`
          : `Show ${s.skill} through a real situation in an Experience or Projects bullet instead of only listing it. If you need one, ${practiceFor(s.skill)}.`,
        evidenceToAdd: `A bullet under Experience or Projects that names ${s.skill}, e.g. "<Action verb> <what> with ${s.skill}, <result>".`,
        impactPoints,
        impactNote: impactText(impactPoints, parts),
      });
    }
  }

  if (input.experience) {
    const { requirement, needYears, haveYears, datesFound, score } = input.experience;
    const impactPoints = points(input.weightOf("experience") * (100 - score));
    recs.push({
      kind: "experience",
      target: "Experience",
      requirementType: requirement.requirementType,
      group: "other",
      whyItMatters: `The job description asks for ${needYears}+ years of experience${requirement.requirementType === "preferred" ? " (preferred)" : ""}.`,
      jdEvidence: requirement.jdEvidence,
      currentEvidence: datesFound ? `About ${haveYears} years detected from dated roles.` : null,
      gap: datesFound ? `About ${haveYears} of the ${needYears} years were detected.` : "No dated roles were found, so no experience could be counted.",
      action: datesFound
        ? "Make sure every internship, part-time or freelance role has start and end dates. More years can only come with time, so lean on projects meanwhile."
        : "Add start and end dates to every role (for example Jan 2024 - Jun 2024), including internships.",
      evidenceToAdd: "A date range on each role in your Experience section.",
      impactPoints,
      impactNote: impactPoints
        ? `About +${impactPoints} point${impactPoints === 1 ? "" : "s"} once the ${needYears} years are met (Experience).`
        : "Less than 1 point (Experience).",
    });
  }

  if (input.education) {
    const { requirement, needed, have, equivalentAccepted } = input.education;
    const impactPoints = equivalentAccepted ? 0 : points(input.weightOf("education") * 100);
    recs.push({
      kind: "education",
      target: "Education",
      requirementType: requirement.requirementType,
      group: "other",
      whyItMatters: `The job description asks for a ${needed}${equivalentAccepted ? " or equivalent experience" : ""}.`,
      jdEvidence: requirement.jdEvidence,
      currentEvidence: have ? `${have} detected.` : null,
      gap: have ? `${have} detected; ${needed} asked for.` : `No degree was detected; ${needed} asked for.`,
      action: equivalentAccepted
        ? "Make your equivalent practical experience easy to see: roles, projects and how long you worked on them."
        : "A degree can't be added quickly. If you are studying for one, list it with the expected year; otherwise highlight relevant coursework and experience.",
      evidenceToAdd: equivalentAccepted
        ? "Experience and Projects entries with dates that show sustained, relevant work."
        : "An Education entry with the degree name and (expected) completion year.",
      impactPoints,
      impactNote: equivalentAccepted ? "Not scored: equivalent experience can't be verified from a resume." : `About +${impactPoints} points if the degree requirement is met (Education).`,
    });
  }

  for (const c of input.certifications) {
    const w = REQUIREMENT_WEIGHT[c.requirementType];
    const impactPoints = input.certificationTotalWeight ? points((input.weightOf("certifications") * w * 100) / input.certificationTotalWeight) : 0;
    const name = c.skill ? `${c.skill} certification` : "certification";
    recs.push({
      kind: "certification",
      target: c.skill ? `${c.skill} certification` : "Certification",
      requirementType: c.requirementType,
      group: "other",
      whyItMatters: `The job description mentions a ${name}${c.requirementType === "preferred" ? " as a plus" : ""}.`,
      jdEvidence: c.jdEvidence,
      currentEvidence: c.courseOnly ? "A related course is listed, but not a certification." : null,
      gap: c.courseOnly ? "A course is listed, which isn't the certification itself." : `No ${name} was found.`,
      action: `Consider earning the ${name} the job description mentions, and list it under Certifications once you have it.`,
      evidenceToAdd: "A Certifications entry with the exact certification name, the issuer and the year earned.",
      impactPoints,
      impactNote: impactPoints ? `About +${impactPoints} point${impactPoints === 1 ? "" : "s"} (Certifications).` : "Less than 1 point (Certifications).",
    });
  }

  return recs
    .sort((a, b) => rankOf(a) - rankOf(b) || b.impactPoints - a.impactPoints || a.target.localeCompare(b.target))
    .map((r, i) => ({ priority: i + 1, ...r }));
}

/** The four "Why not me" lists, kept for older clients and the assistant. Built from the same facts. */
export function legacyWhyNotMe(
  strong: SkillStatus[],
  partial: SkillStatus[],
  missing: SkillStatus[],
  components: ScoreComponent[],
  recommendations: Recommendation[]
) {
  const strengths = strong.map((s) => `${s.skill} is demonstrated in your ${s.section} section`);
  for (const c of components) {
    if ((c.key === "experience" || c.key === "education") && c.score >= 100) strengths.push(c.description);
  }
  const gaps = [
    ...missing.filter((s) => s.requirementType === "required").map((s) => `${s.skill} is required by the job description but not found in your resume`),
    ...missing.filter((s) => s.requirementType === "preferred").map((s) => `${s.skill} (preferred) is not found in your resume`),
  ];
  for (const c of components) {
    if ((c.key === "experience" || c.key === "education") && c.score < 100) gaps.push(c.description);
  }
  const weakSupport = partial.map((s) => `${s.skill} only appears in your ${s.section} section, not in experience or project work`);
  const improvements = recommendations.slice(0, 6).map((r) => r.action);
  return { strengths, gaps, weakSupport, improvements };
}
