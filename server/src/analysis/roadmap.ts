import { practiceFor } from "./recommendations.js";
import { PREREQUISITES, skillCategory } from "./skills.js";
import type { RoadmapItem, RoadmapStep, SkillStatus } from "./types.js";

/**
 * Career roadmap: required gaps first (missing, then partial), then preferred gaps, then Strong skills to maintain.
 * A skill that another roadmap item builds on is moved before it. Stages describe what to do, never when: no dates.
 */

const GROUP_RANK: Record<RoadmapItem["group"], number> = {
  "required-missing": 0,
  "required-partial": 1,
  "preferred-missing": 2,
  "preferred-partial": 3,
  maintain: 4,
};

const quote = (s: string) => `"${s}"`;
const capitalise = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

const list = (xs: string[]) => xs.join(" and ");
const isAre = (xs: string[]) => (xs.length === 1 ? "is" : "are");

function stepsFor(s: SkillStatus, prerequisites: string[], unmentionedPrereqs: string[], strongPrereqs: string[]): RoadmapStep[] {
  const soft = skillCategory(s.skill) === "soft";
  const builds = [
    ...(strongPrereqs.length ? [`It builds on ${list(strongPrereqs)}, which you already show.`] : []),
    ...(prerequisites.length ? [`It builds on ${list(prerequisites)}, which ${isAre(prerequisites)} earlier in this roadmap.`] : []),
    ...(unmentionedPrereqs.length ? [`It builds on ${unmentionedPrereqs.join(" and ")}, which your resume doesn't mention; start there if ${unmentionedPrereqs.length === 1 ? "it's" : "they're"} new to you.`] : []),
  ].join(" ");

  if (s.status === "strong") {
    return [
      { phase: "document", text: `Already demonstrated. Keep ${s.skill} current and state the real outcome of that work where you can.` },
    ];
  }

  const reanalyze = {
    phase: "reanalyze" as const,
    text:
      s.status === "missing"
        ? `Re-run the analysis with your updated resume to check that ${s.skill} is now found.`
        : `Re-run the analysis with your updated resume to check that ${s.skill} moves from Partial to Strong.`,
  };

  if (s.status === "missing") {
    return [
      { phase: "learn", text: `${soft ? "Practise" : "Learn the fundamentals of"} ${s.skill}. ${builds}`.trim() },
      { phase: "build", text: `${capitalise(practiceFor(s.skill))}, aimed at what the job description asks: ${quote(s.jdEvidence)}` },
      { phase: "demonstrate", text: `Add it to your resume under Projects or Experience, in a bullet that names ${s.skill} and says what you did.` },
      { phase: "document", text: "Keep the code, write-up or other proof, and describe only what you actually did." },
      reanalyze,
    ];
  }
  return [
    { phase: "learn", text: `You already list ${s.skill}. Refresh the parts the job description emphasises: ${quote(s.jdEvidence)}${/[.!?]$/.test(s.jdEvidence) ? "" : "."} ${builds}`.trim() },
    {
      phase: "build",
      text: soft
        ? `Show ${s.skill} in a real situation: at work, in an internship, a team project or a club role.`
        : `Use ${s.skill} in a real task at work or in an internship, or ${practiceFor(s.skill)}.`,
    },
    { phase: "demonstrate", text: `Move it from your ${s.section ?? "skills"} list into an Experience or Projects bullet that shows it in use.` },
    { phase: "document", text: "Say what you did and what came of it, using only real results." },
    reanalyze,
  ];
}

export function buildRoadmap(statuses: SkillStatus[], resumeSkills: Set<string>): RoadmapItem[] {
  const groupOf = (s: SkillStatus): RoadmapItem["group"] => (s.status === "strong" ? "maintain" : (`${s.requirementType}-${s.status}` as RoadmapItem["group"]));
  const sorted = [...statuses].sort((a, b) => GROUP_RANK[groupOf(a)] - GROUP_RANK[groupOf(b)] || a.skill.localeCompare(b.skill));
  const gaps = new Map(sorted.filter((s) => s.status !== "strong").map((s) => [s.skill, s]));
  const inAnalysis = new Set(statuses.map((s) => s.skill));

  const ordered: Array<{ status: SkillStatus; movedEarlierFor?: string }> = [];
  const placed = new Set<string>();
  const place = (s: SkillStatus, forSkill?: string, visiting = new Set<string>()) => {
    if (placed.has(s.skill) || visiting.has(s.skill)) return;
    visiting.add(s.skill);
    if (s.status !== "strong") {
      for (const pre of PREREQUISITES[s.skill] ?? []) {
        const gap = gaps.get(pre);
        if (gap && !placed.has(pre)) place(gap, s.skill, visiting);
      }
    }
    placed.add(s.skill);
    ordered.push({ status: s, movedEarlierFor: forSkill });
  };
  for (const s of sorted) place(s);

  return ordered.map(({ status: s, movedEarlierFor }, i) => {
    const prereqs = (PREREQUISITES[s.skill] ?? []).filter((p) => gaps.has(p));
    const unmentioned = (PREREQUISITES[s.skill] ?? []).filter((p) => !inAnalysis.has(p) && !resumeSkills.has(p));
    const strongPrereqs = (PREREQUISITES[s.skill] ?? []).filter((p) => statuses.some((x) => x.skill === p && x.status === "strong"));
    const group = groupOf(s);
    // Only report a move when the item really jumped ahead of its own group's position.
    const moved = movedEarlierFor && GROUP_RANK[group] > GROUP_RANK[groupOf(gaps.get(movedEarlierFor) ?? s)] ? movedEarlierFor : undefined;
    return {
      order: i + 1,
      skill: s.skill,
      status: s.status,
      requirementType: s.requirementType,
      group,
      prerequisites: prereqs,
      ...(moved ? { movedEarlierFor: moved } : {}),
      steps: stepsFor(s, prereqs, s.status === "strong" ? [] : unmentioned, strongPrereqs),
    };
  });
}
