import { DEGREE_LEVELS, requiredDegree, requiredYears } from "./signals.js";
import { CATEGORY_LABEL, COMPILED_SKILLS, isAmbiguousMention, mentionsSkill } from "./skills.js";
import type { Confidence, JdRequirement, RequirementType } from "./types.js";

/**
 * Job description decomposition: splits the JD into sentences, tracks the heading each one sits under, and turns them
 * into structured requirements (skills, years of experience, degree, certifications), each with the sentence it came
 * from and the reason it was classed as required or preferred.
 */

const PREFERRED_CUE =
  /\b(preferred|nice[\s-]to[\s-]have|good[\s-]to[\s-]have|bonus|a\s+plus|desirable|desired|advantage(ous)?|optional|ideally)\b/i;
const REQUIRED_CUE =
  /\b(must|required|requirement|mandatory|essential|need(ed)?|minimum|proficien(t|cy)|strong|solid|hands[\s-]on|expert(ise)?|experience\s+(with|in|building))\b/i;
const PREFERRED_HEADING = /^(preferred|nice\s+to\s+have|good\s+to\s+have|bonus|desired|desirable|additional|plus)\b/i;
const REQUIRED_HEADING =
  /^(required|requirements|must\s+have|minimum|basic|mandatory|qualifications|what\s+you('ll)?\s+(need|bring)|who\s+you\s+are|responsibilities|key\s+skills|skills|you\s+have)\b/i;
/** Sections that describe the employer or the offer; skills mentioned only there are not requirements. */
const NON_REQUIREMENT_HEADING = /^(benefits|perks|what\s+we\s+offer|why\s+join|compensation|salary|how\s+to\s+apply|equal\s+opportunity|about\s+the\s+(company|team))\b/i;

export interface JdSentence {
  text: string;
  /** The heading this sentence sits under, or null before the first recognised heading. */
  heading: { text: string; kind: "required" | "preferred" | "non-requirement" } | null;
  preferredCue: string | null;
  requiredCue: string | null;
}

function headingKind(text: string): NonNullable<JdSentence["heading"]>["kind"] | null {
  if (NON_REQUIREMENT_HEADING.test(text)) return "non-requirement";
  if (PREFERRED_HEADING.test(text)) return "preferred";
  if (REQUIRED_HEADING.test(text)) return "required";
  return null;
}

const words = (s: string) => s.split(/\s+/).filter(Boolean).length;

export function jdSentences(jd: string): JdSentence[] {
  const out: JdSentence[] = [];
  let heading: JdSentence["heading"] = null;
  for (const rawLine of jd.split(/\r?\n/)) {
    let line = rawLine.replace(/^[•\-*\s]+/, "").trim();
    if (!line) continue;
    // A heading is a short line ("Nice to have", "Requirements:") or a short label before a colon ("Preferred: Terraform").
    const colon = line.indexOf(":");
    const label = colon >= 0 ? line.slice(0, colon).trim() : line;
    const isLabel = colon >= 0 ? words(label) <= 6 : words(line) <= 4;
    const kind = isLabel ? headingKind(label) : null;
    if (kind) {
      heading = { text: label, kind };
      line = colon >= 0 ? line.slice(colon + 1).trim() : "";
      if (!line) continue;
    }
    for (const sentence of line.split(/(?<=[.;!?])\s+/)) {
      const text = sentence.trim();
      if (!text) continue;
      out.push({ text, heading, preferredCue: text.match(PREFERRED_CUE)?.[0] ?? null, requiredCue: text.match(REQUIRED_CUE)?.[0] ?? null });
    }
  }
  return out;
}

interface TypeDecision {
  requirementType: RequirementType;
  typeReason: string;
  confidence: Confidence;
}

/** Required or preferred for one sentence, with the reason. Explicit wording beats the heading it sits under. */
export function classifySentence(s: JdSentence): TypeDecision {
  if (s.preferredCue) return { requirementType: "preferred", typeReason: `The job description says "${s.preferredCue}"`, confidence: "high" };
  if (s.heading?.kind === "preferred") return { requirementType: "preferred", typeReason: `Listed under "${s.heading.text}"`, confidence: "high" };
  if (s.heading?.kind === "required") return { requirementType: "required", typeReason: `Listed under "${s.heading.text}"`, confidence: "high" };
  if (s.requiredCue) return { requirementType: "required", typeReason: `The job description says "${s.requiredCue}"`, confidence: "high" };
  if (!s.heading) {
    return {
      requirementType: "required",
      typeReason: "Mentioned in the role description rather than under a requirements heading, so treated as required",
      confidence: "medium",
    };
  }
  return { requirementType: "required", typeReason: "No preferred wording nearby, so treated as required", confidence: "medium" };
}

const TRIM = 240;
export const trimSentence = (t: string) => (t.length > TRIM ? t.slice(0, TRIM - 3).trimEnd() + "..." : t);

const lowerConfidence = (a: Confidence, b: Confidence): Confidence => (a === "low" || b === "low" ? "low" : a === "medium" || b === "medium" ? "medium" : "high");

/** Picks the sentence that decides the requirement: any required mention wins, and explicit wording beats a default. */
function decide(sentences: JdSentence[]): { sentence: JdSentence; decision: TypeDecision } {
  const decided = sentences.map((sentence) => ({ sentence, decision: classifySentence(sentence) }));
  const rank = (d: TypeDecision) => (d.requirementType === "required" ? 0 : 2) + (d.confidence === "high" ? 0 : 1);
  return decided.sort((a, b) => rank(a.decision) - rank(b.decision))[0];
}

export interface EducationRequirement extends JdRequirement {
  level: number;
  /** The JD accepts equivalent experience instead of the degree. */
  equivalentAccepted: boolean;
  /** The JD names a field of study (not checked against the resume). */
  fieldMentioned: boolean;
}

export interface ExperienceRequirement extends JdRequirement {
  years: number;
}

export interface CertificationRequirement extends JdRequirement {
  /** Skill the certification is in, or null for "certification" in general. */
  skill: string | null;
}

export interface SkillRequirement extends JdRequirement {
  skill: string;
}

export interface DecomposedJd {
  skills: SkillRequirement[];
  experience: ExperienceRequirement | null;
  education: EducationRequirement | null;
  certifications: CertificationRequirement[];
  all: JdRequirement[];
}

const EQUIVALENT = /\bor\s+equivalent\b|\bequivalent\s+(practical\s+|work\s+|professional\s+|industry\s+)?experience\b/i;
const FIELD = /\b(computer\s+science|information\s+technology|software\s+engineering|engineering|mathematics|statistics|data\s+science|related\s+(field|discipline)|a\s+related|technical\s+field|STEM)\b/i;

export function decomposeJd(jd: string): DecomposedJd {
  const sentences = jdSentences(jd).filter((s) => s.heading?.kind !== "non-requirement");

  const skills: SkillRequirement[] = [];
  for (const skill of COMPILED_SKILLS) {
    const hits = sentences.filter((s) => mentionsSkill(skill, s.text));
    if (!hits.length) continue;
    const { sentence, decision } = decide(hits);
    const ambiguous = hits.every((h) => isAmbiguousMention(skill, h.text));
    skills.push({
      id: `skill:${skill.name}`,
      kind: "skill",
      label: skill.name,
      skill: skill.name,
      category: CATEGORY_LABEL[skill.category],
      requirementType: decision.requirementType,
      jdEvidence: trimSentence(sentence.text),
      typeReason: ambiguous ? `${decision.typeReason}. Recognised from a word that can also be ordinary English` : decision.typeReason,
      confidence: ambiguous ? "low" : decision.confidence,
    });
  }

  let experience: ExperienceRequirement | null = null;
  for (const s of sentences) {
    const years = requiredYears(s.text);
    if (years === null || years <= 0) continue;
    const decision = classifySentence(s);
    experience = {
      id: "experience",
      kind: "experience",
      label: `${years}+ years of experience`,
      category: "Experience",
      years,
      requirementType: decision.requirementType,
      jdEvidence: trimSentence(s.text),
      typeReason: decision.typeReason,
      confidence: decision.confidence,
    };
    break;
  }

  let education: EducationRequirement | null = null;
  const degreeSentences = sentences.filter((s) => requiredDegree(s.text) > 0);
  if (degreeSentences.length) {
    const lowest = degreeSentences.reduce((a, b) => (requiredDegree(b.text) < requiredDegree(a.text) ? b : a));
    const level = requiredDegree(lowest.text);
    const { decision } = decide(degreeSentences.filter((s) => requiredDegree(s.text) === level));
    education = {
      id: "education",
      kind: "education",
      label: `${DEGREE_LEVELS[level]} degree`,
      category: "Education",
      level,
      equivalentAccepted: degreeSentences.some((s) => EQUIVALENT.test(s.text)),
      fieldMentioned: degreeSentences.some((s) => FIELD.test(s.text)),
      requirementType: decision.requirementType,
      jdEvidence: trimSentence(lowest.text),
      typeReason: decision.typeReason,
      confidence: decision.confidence,
    };
  }

  const certifications: CertificationRequirement[] = [];
  for (const s of sentences.filter((x) => /certif/i.test(x.text))) {
    const decision = classifySentence(s);
    const named = COMPILED_SKILLS.filter((k) => mentionsSkill(k, s.text));
    for (const skill of named.length ? named.map((k) => k.name) : [null]) {
      const id = `certification:${skill ?? "any"}`;
      const existing = certifications.find((c) => c.id === id);
      if (existing) {
        if (existing.requirementType === "preferred" && decision.requirementType === "required") Object.assign(existing, decision, { jdEvidence: trimSentence(s.text) });
        continue;
      }
      certifications.push({
        id,
        kind: "certification",
        label: skill ? `${skill} certification` : "Certification",
        category: "Certification",
        skill,
        jdEvidence: trimSentence(s.text),
        ...decision,
      });
    }
  }

  const all: JdRequirement[] = [...skills, ...(experience ? [experience] : []), ...(education ? [education] : []), ...certifications].map(
    (r) => ({ id: r.id, kind: r.kind, label: r.label, category: r.category, requirementType: r.requirementType, jdEvidence: r.jdEvidence, typeReason: r.typeReason, confidence: r.confidence })
  );
  return { skills, experience, education, certifications, all };
}

export { lowerConfidence };
