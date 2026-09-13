// Mirrors src/types/index.ts on the frontend. Keep the two in sync.

export type SkillLevel = "strong" | "partial" | "missing";

export interface SkillStatus {
  skill: string;
  status: SkillLevel;
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
