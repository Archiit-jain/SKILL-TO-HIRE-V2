import type { ComponentKey, SkillLevel } from "./types.js";

/** Component weights, taken from the original Skill2Hire frontend prototype. See docs/SCORING.md. */
export const WEIGHTS: Record<ComponentKey, number> = {
  skills: 0.35,
  wording: 0.25,
  experience: 0.15,
  education: 0.1,
  projects: 0.1,
  certifications: 0.05,
};

/** A preferred requirement counts half as much as a required one (skills, and the experience/education/certification components). */
export const REQUIREMENT_WEIGHT = { required: 1, preferred: 0.5 } as const;

/** Share of a skill's weight earned at each rating. */
export const LEVEL_CREDIT: Record<SkillLevel, number> = { strong: 1, partial: 0.5, missing: 0 };
