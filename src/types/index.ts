export type Page = "home" | "analysis" | "results" | "assistant" | "roadmap" | "progress" | "settings";

export interface User {
  name: string;
  email: string;
  hasPassword: boolean;
  googleLinked: boolean;
  emailVerified: boolean;
}

export interface AuthProviders {
  /** OAuth client ID for "Sign in with Google", or null when not configured. */
  googleClientId: string | null;
  /** false when the server can't send verification emails, so email sign-up is disabled. */
  emailSignup: boolean;
  /** false when the server stores data somewhere that can reset (e.g. Vercel /tmp without a hosted database). */
  persistentStorage?: boolean;
}

export interface SignupResult {
  verificationRequired: true;
  email: string;
}

export interface UserSettings {
  privacyMode: boolean;
  notifications: boolean;
}

// ---- Analysis result: mirrors server/src/analysis/types.ts ------------------------------------------------------------
// Fields added in engine 2.0 are optional here, because analyses saved by engine 1.0 don't have them.

export type SkillLevel = "strong" | "partial" | "missing";
export type RequirementType = "required" | "preferred";
export type Confidence = "high" | "medium" | "low";

export interface JdRequirement {
  id: string;
  kind: "skill" | "experience" | "education" | "certification";
  label: string;
  category: string;
  requirementType: RequirementType;
  jdEvidence: string;
  typeReason: string;
  confidence: Confidence;
}

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
  evidence?: string;
  section?: string;
  importanceWeight: number;
  category?: string;
  jdEvidence?: string;
  reason?: string;
  confidence?: Confidence;
  related?: RelatedEvidence[];
}

export interface ScoreComponent {
  name: string;
  score: number;
  weight: number;
  description: string;
  key?: "skills" | "wording" | "experience" | "education" | "projects" | "certifications";
  contribution?: number;
  confidence?: Confidence;
}

export type RecommendationGroup = "required-missing" | "required-partial" | "preferred-missing" | "preferred-partial" | "other";

export interface Recommendation {
  priority: number;
  kind: "skill" | "experience" | "education" | "certification";
  target: string;
  requirementType: RequirementType;
  group: RecommendationGroup;
  whyItMatters: string;
  jdEvidence: string;
  currentEvidence: string | null;
  gap: string;
  action: string;
  evidenceToAdd: string;
  impactPoints: number;
  impactNote: string;
}

export type RoadmapGroup = "required-missing" | "required-partial" | "preferred-missing" | "preferred-partial" | "maintain";

export interface RoadmapStep {
  phase: "learn" | "build" | "demonstrate" | "document" | "reanalyze";
  text: string;
}

export interface RoadmapItem {
  order: number;
  skill: string;
  status: SkillLevel;
  requirementType: RequirementType;
  group: RoadmapGroup;
  prerequisites: string[];
  movedEarlierFor?: string;
  steps: RoadmapStep[];
}

export interface AnalysisResult {
  id: string;
  overallScore: number;
  components: ScoreComponent[];
  /** Components skipped because the job description gave no basis for them. */
  notAssessed: string[];
  strongSkills: SkillStatus[];
  partialSkills: SkillStatus[];
  missingSkills: SkillStatus[];
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
  requirements?: JdRequirement[];
  confidence?: { level: Confidence; reasons: string[] };
  recommendations?: Recommendation[];
  roadmap?: RoadmapItem[];
  /** The built-in sample analysis (synthetic documents, never stored). */
  demo?: boolean;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

export interface ProgressEntry {
  id: string;
  date: string;
  score: number;
  jdTitle: string;
  resumeName: string;
  strongCount: number;
  partialCount: number;
  missingCount: number;
}
