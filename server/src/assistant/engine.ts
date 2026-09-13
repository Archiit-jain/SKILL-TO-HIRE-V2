import type { AnalysisResult, SkillStatus } from "../analysis/types.js";
import { config } from "../config.js";
import { phraseWithGemini } from "./gemini.js";

export interface AssistantReply {
  content: string;
  sources: string[];
  mode: "rules" | "gemini";
}

const list = (items: string[]) => items.map((s, i) => `${i + 1}. ${s}`).join("\n");

function describeSkill(s: SkillStatus): string {
  const label = s.status === "strong" ? "Strong" : s.status === "partial" ? "Partial" : "Missing";
  const req = s.requirementType === "required" ? "a required" : "a preferred";
  if (s.status === "missing") {
    return `**${s.skill}** is rated **Missing**. The job description lists it as ${req} skill, and it was not found anywhere in your resume.`;
  }
  const why =
    s.status === "strong"
      ? `It is demonstrated in your ${s.section} section, which counts as applied evidence.`
      : `It only appears in your ${s.section} section. A skill counts as Strong only when it shows up in experience or project work.`;
  return `**${s.skill}** is rated **${label}** (${req} skill). ${why}\n\nEvidence used: "${s.evidence}"`;
}

/**
 * Deterministic answer built only from the stored analysis. Every sentence traces back to a field of the result,
 * which is what the "sources" badges name.
 */
export function answerFromAnalysis(question: string, result: AnalysisResult | null): AssistantReply {
  const q = question.toLowerCase();
  if (!result) {
    return {
      content:
        "I don't have an analysis to work from yet. Run **New Analysis** with your resume and a job description, then ask me about your score, skill gaps or what to learn next.",
      sources: [],
      mode: "rules",
    };
  }

  const all = [...result.strongSkills, ...result.partialSkills, ...result.missingSkills];
  const mentioned = all.filter((s) => new RegExp(`(^|[^a-z0-9+#])${s.skill.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9+#])`).test(q));
  const reqMissing = result.missingSkills.filter((s) => s.requirementType === "required");
  const prefMissing = result.missingSkills.filter((s) => s.requirementType === "preferred");

  if (mentioned.length) {
    return {
      content: mentioned.map(describeSkill).join("\n\n"),
      sources: ["Skill Gap Analysis", "Resume Evidence"],
      mode: "rules",
    };
  }

  if (/\b(score|match|why\s+(did|do|is)|percent|compatib|rating)\b/.test(q)) {
    const lines = result.components.map((c) => `**${c.name}**: ${c.score.toFixed(0)}/100 (weight ${(c.weight * 100).toFixed(0)}%) - ${c.description}`);
    const excluded = result.notAssessed.length ? `\n\nNot scored: ${result.notAssessed.join("; ")}.` : "";
    return {
      content: `Your overall match for **${result.jdTitle}** is **${result.overallScore.toFixed(1)}/100**, a weighted average of:\n\n${list(lines)}${excluded}`,
      sources: ["Score Breakdown"],
      mode: "rules",
    };
  }

  if (/\b(improve|first|priorit|focus|start)\b/.test(q)) {
    const steps = [
      ...reqMissing.map((s) => `**${s.skill}** (missing, required) - learn it and use it in a project you can list.`),
      ...result.partialSkills.map((s) => `**${s.skill}** (partial) - add a concrete experience or project bullet that shows it in use.`),
      ...prefMissing.map((s) => `**${s.skill}** (missing, preferred) - worth adding once the required gaps are closed.`),
    ];
    return {
      content: steps.length
        ? `Ordered by impact on your score (required gaps carry double the weight of preferred ones):\n\n${list(steps.slice(0, 6))}`
        : "Every skill recognised in this job description is already Strong in your resume. Focus on quantifying the impact of that work.",
      sources: ["Skill Gap Analysis", "Scoring Weights"],
      mode: "rules",
    };
  }

  if (/\b(resume|cv|strengthen|rewrite|bullet)\b/.test(q)) {
    const items = [...result.whyNotMe.improvements, ...result.whyNotMe.weakSupport.map((w) => `Address: ${w}`)];
    return {
      content: items.length
        ? `To strengthen your resume for **${result.jdTitle}**:\n\n${list(items)}\n\nOnly add claims you can back up - never invent metrics.`
        : "Your resume already covers every recognised requirement with applied evidence.",
      sources: ["Why Not Me", "Resume Evidence"],
      mode: "rules",
    };
  }

  if (/\b(learn|job[\s-]?ready|roadmap|path|study|course)\b/.test(q)) {
    const path = [...reqMissing, ...result.partialSkills, ...prefMissing].map(
      (s) => `**${s.skill}** - ${s.status === "missing" ? "learn the fundamentals, then build something with it" : "turn your existing exposure into a demonstrated project"}`
    );
    return {
      content: path.length
        ? `A learning path for this role, highest impact first:\n\n${list(path)}\n\nA skill counts as Strong once it appears in your experience or project work.`
        : "There are no skill gaps against this job description. Re-run the analysis against a more senior role to find the next steps.",
      sources: ["Career Roadmap", "Skill Gap Analysis"],
      mode: "rules",
    };
  }

  if (/\b(missing|gap|lack|weak)\b/.test(q)) {
    const items = [...result.whyNotMe.gaps, ...result.whyNotMe.weakSupport];
    return {
      content: items.length ? `Here's what is holding the score back:\n\n${list(items)}` : "No gaps were found against this job description.",
      sources: ["Why Not Me"],
      mode: "rules",
    };
  }

  if (/\b(strength|strong|good\s+at|already\s+have)\b/.test(q)) {
    return {
      content: result.whyNotMe.strengths.length
        ? `What you already bring:\n\n${list(result.whyNotMe.strengths)}`
        : "No skills were demonstrated in experience or project work yet - that's the first thing to fix.",
      sources: ["Why Not Me"],
      mode: "rules",
    };
  }

  return {
    content: `Your latest analysis is **${result.resumeName}** vs **${result.jdTitle}** (${result.overallScore.toFixed(1)}/100): ${result.strongSkills.length} strong, ${result.partialSkills.length} partial and ${result.missingSkills.length} missing skills.\n\nYou can ask me why a specific skill got its rating, how the score was calculated, what to improve first, or what to learn next.`,
    sources: ["Analysis Summary"],
    mode: "rules",
  };
}

export async function answer(question: string, result: AnalysisResult | null): Promise<AssistantReply> {
  const base = answerFromAnalysis(question, result);
  if (!config.gemini || !result) return base;
  try {
    const phrased = await phraseWithGemini(config.gemini, question, result, base.content);
    return phrased ? { content: phrased, sources: base.sources, mode: "gemini" } : base;
  } catch (err) {
    console.warn("[assistant] Gemini call failed, using rule-based answer:", (err as Error).message);
    return base;
  }
}
