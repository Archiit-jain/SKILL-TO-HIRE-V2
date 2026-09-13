export type Page = "home" | "analysis" | "results" | "assistant" | "roadmap" | "progress" | "settings";

export interface User {
  name: string;
  email: string;
}

export interface UserSettings {
  privacyMode: boolean;
  notifications: boolean;
}

export interface SkillStatus {
  skill: string;
  status: "strong" | "partial" | "missing";
  requirementType: "required" | "preferred";
  evidence?: string;
  similarityScore?: number;
  section?: string;
  importanceWeight: number;
}

export interface ScoreComponent {
  name: string;
  score: number;
  weight: number;
  description: string;
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
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sources?: string[];
}

export interface RoadmapItem {
  skill: string;
  status: "strong" | "partial" | "missing";
  action: string;
  priority: "high" | "medium" | "low";
  stage: number;
  resource?: string;
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
