// Mirrors src/types/index.ts on the frontend. Keep the two in sync.
// Fields added in engine 2.0 are optional on the frontend, because results saved by engine 1.0 don't have them.

export type SkillLevel = "strong" | "partial" | "missing";
export type RequirementType = "required" | "preferred";
/** How much a conclusion can be trusted, from the evidence behind it. Categorical on purpose: no invented percentages. */
export type Confidence = "high" | "medium" | "low";

/** One requirement decomposed from the job description. */
export interface JdRequirement {
  /** Stable key, e.g. "skill:Python", "experience", "education", "certification:AWS". */
  id: string;
  kind: "skill" | "experience" | "education" | "certification";
  label: string;
  /** Skill category label ("Cloud", "Database", ...) for skills; the kind for everything else. */
  category: string;
  requirementType: RequirementType;
  /** The job description sentence the requirement was read from (trimmed). */
  jdEvidence: string;
  /** Why it was classified as required or preferred. */
  typeReason: string;
  confidence: Confidence;
}

/** A related-but-different skill found in the resume. Never counted as a match. */
export interface RelatedEvidence {
  skill: string;
  section: string;
  evidence: string;
  note: string;
}

export interface SkillStatus {
  skill: string;
  status: SkillLevel;
  requirementType: RequirementType;
  category: string;
  /** Resume line used as evidence (Strong/Partial only). */
  evidence?: string;
  section?: string;
  /** The job description sentence that asks for this skill. */
  jdEvidence: string;
  /** Plain-language explanation of the rating. */
  reason: string;
  confidence: Confidence;
  related: RelatedEvidence[];
  importanceWeight: number;
}

export type ComponentKey = "skills" | "wording" | "experience" | "education" | "projects" | "certifications";

export interface ScoreComponent {
  key: ComponentKey;
  name: string;
  /** 0-100, one decimal. */
  score: number;
  /** Share of the overall score after renormalising over assessed components (sums to 1). */
  weight: number;
  /** Points this component adds to the overall score (score x weight), one decimal. */
  contribution: number;
  description: string;
  confidence: Confidence;
}

export interface Recommendation {
  /** 1 = do this first. */
  priority: number;
  kind: "skill" | "experience" | "education" | "certification";
  /** Skill name, or "Experience" / "Education" / "Certification". */
  target: string;
  requirementType: RequirementType;
  group: "required-missing" | "required-partial" | "preferred-missing" | "preferred-partial" | "other";
  whyItMatters: string;
  jdEvidence: string;
  currentEvidence: string | null;
  gap: string;
  action: string;
  evidenceToAdd: string;
  /**
   * Estimated overall-score points gained if the gap is closed as described, from the component weights (whole
   * points, never negative). Wording Similarity would also change and is not included.
   */
  impactPoints: number;
  impactNote: string;
}

export interface RoadmapStep {
  phase: "learn" | "build" | "demonstrate" | "document" | "reanalyze";
  text: string;
}

export interface RoadmapItem {
  order: number;
  skill: string;
  status: SkillLevel;
  requirementType: RequirementType;
  group: "required-missing" | "required-partial" | "preferred-missing" | "preferred-partial" | "maintain";
  /** Skills from this roadmap to work on first. */
  prerequisites: string[];
  /** Set when the item was moved earlier because a later item depends on it. */
  movedEarlierFor?: string;
  steps: RoadmapStep[];
}

export interface AnalysisResult {
  id: string;
  /** Whole number 0-100. */
  overallScore: number;
  components: ScoreComponent[];
  notAssessed: string[];
  requirements: JdRequirement[];
  strongSkills: SkillStatus[];
  partialSkills: SkillStatus[];
  missingSkills: SkillStatus[];
  confidence: { level: Confidence; reasons: string[] };
  recommendations: Recommendation[];
  roadmap: RoadmapItem[];
  whyNotMe: {
    strengths: string[];
    gaps: string[];
    weakSupport: string[];
    improvements: string[];
  };
  resumeName: string;
  jdTitle: string;
  analyzedAt: string;
  engineVersion: string;
  /** Present on the built-in sample analysis, which is never stored. */
  demo?: boolean;
}
