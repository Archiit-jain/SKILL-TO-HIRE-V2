import type { AnalysisResult, Recommendation, SkillStatus } from "../analysis/types.js";
import type { Db } from "../db.js";
import { buildGeminiPayload, phraseWithGemini, type GeminiPhraser } from "./gemini.js";
import { reserveGeminiAnswer, type GeminiQuotaLimits } from "./quota.js";
import { validateGeminiAnswer } from "./validate.js";

export interface AssistantReply {
  content: string;
  sources: string[];
  mode: "rules" | "gemini";
}

const list = (items: string[]) => items.map((s, i) => `${i + 1}. ${s}`).join("\n");
const RATING = { strong: "Strong", partial: "Partial", missing: "Missing" } as const;

/** Results saved by engine 1.0 have no reasons, recommendations or roadmap; answers fall back to the fields they do have. */
const recommendationsOf = (r: AnalysisResult): Recommendation[] => r.recommendations ?? [];

function describeSkill(s: SkillStatus, rec: Recommendation | undefined): string {
  const req = s.requirementType === "required" ? "a required" : "a preferred";
  if (!s.reason) {
    // Engine 1.0 result.
    if (s.status === "missing") {
      return `**${s.skill}** is rated **Missing**. The job description lists it as ${req} skill, and it was not found anywhere in your resume.`;
    }
    const why =
      s.status === "strong"
        ? `It is demonstrated in your ${s.section} section, which counts as applied evidence.`
        : `It only appears in your ${s.section} section. A skill counts as Strong only when it shows up in experience or project work.`;
    return `**${s.skill}** is rated **${RATING[s.status]}** (${req} skill). ${why}\n\nEvidence used: "${s.evidence}"`;
  }
  const parts = [
    `**${s.skill}** is rated **${RATING[s.status]}** (${req} skill, ${s.confidence} confidence). ${s.reason}`,
    `The job description says: "${s.jdEvidence}"`,
  ];
  if (s.evidence) parts.push(`Resume evidence used: "${s.evidence}"`);
  if (rec) parts.push(`Next step: ${rec.action} ${rec.impactNote}`);
  return parts.join("\n\n");
}

/**
 * Deterministic answer built only from the stored analysis. Every sentence traces back to a field of the result,
 * which is what the "sources" badges name. Nothing here can change a score, a rating or the evidence.
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
  const recs = recommendationsOf(result);
  const reqMissing = result.missingSkills.filter((s) => s.requirementType === "required");
  const prefMissing = result.missingSkills.filter((s) => s.requirementType === "preferred");

  if (mentioned.length) {
    return {
      content: mentioned.map((s) => describeSkill(s, recs.find((r) => r.kind === "skill" && r.target === s.skill))).join("\n\n\n"),
      sources: ["Skill Gap Analysis", "Resume Evidence", ...(mentioned.some((s) => s.jdEvidence) ? ["Job Description"] : [])],
      mode: "rules",
    };
  }

  if (/\b(confiden|reliab|accura|trust)\w*/.test(q) && result.confidence) {
    return {
      content: `Confidence in this analysis: **${result.confidence.level}**.\n\n${list(result.confidence.reasons)}\n\nConfidence describes how clear the evidence is. It isn't a prediction of whether you'll be hired.`,
      sources: ["Analysis Confidence"],
      mode: "rules",
    };
  }

  if (/\b(score|match|why\s+(did|do|is)|percent|compatib|rating|calculat|breakdown)\b/.test(q)) {
    const lines = result.components.map((c) =>
      c.contribution === undefined
        ? `**${c.name}**: ${c.score.toFixed(0)}/100 (weight ${(c.weight * 100).toFixed(0)}%) - ${c.description}`
        : `**${c.name}**: ${c.score}/100 x ${(c.weight * 100).toFixed(1)}% = ${c.contribution} points - ${c.description}`
    );
    const excluded = result.notAssessed.length ? `\n\nNot scored (their weight was shared out over the rest): ${result.notAssessed.join("; ")}.` : "";
    return {
      content: `Your overall match for **${result.jdTitle}** is **${result.overallScore}/100**, a weighted sum of:\n\n${list(lines)}${excluded}`,
      sources: ["Score Breakdown"],
      mode: "rules",
    };
  }

  if (/\b(improve|first|priorit|focus|start|recommend|next)\b/.test(q)) {
    if (recs.length) {
      return {
        content: `In priority order (required gaps first, then larger impact):\n\n${list(
          recs.slice(0, 6).map((r) => `**${r.target}** - ${r.gap} ${r.action} (${r.impactNote})`)
        )}`,
        sources: ["Why Not Me", "Scoring Weights"],
        mode: "rules",
      };
    }
    const steps = [
      ...reqMissing.map((s) => `**${s.skill}** (missing, required) - learn it and use it in a project you can list.`),
      ...result.partialSkills.map((s) => `**${s.skill}** (partial) - add a concrete experience or project bullet that shows it in use.`),
      ...prefMissing.map((s) => `**${s.skill}** (missing, preferred) - worth adding once the required gaps are closed.`),
    ];
    return {
      content: steps.length
        ? `Ordered by impact on your score (required gaps carry double the weight of preferred ones):\n\n${list(steps.slice(0, 6))}`
        : "Every skill recognised in this job description is already Strong in your resume. Focus on stating the real outcomes of that work.",
      sources: ["Skill Gap Analysis", "Scoring Weights"],
      mode: "rules",
    };
  }

  if (/\b(resume|cv|strengthen|rewrite|bullet)\b/.test(q)) {
    const items = recs.length
      ? recs.slice(0, 6).map((r) => `**${r.target}**: ${r.evidenceToAdd}`)
      : [...result.whyNotMe.improvements, ...result.whyNotMe.weakSupport.map((w) => `Address: ${w}`)];
    return {
      content: items.length
        ? `To strengthen your resume for **${result.jdTitle}**:\n\n${list(items)}\n\nOnly add claims you can back up - never invent metrics.`
        : "Your resume already covers every recognised requirement with applied evidence.",
      sources: ["Why Not Me", "Resume Evidence"],
      mode: "rules",
    };
  }

  if (/\b(learn|job[\s-]?ready|roadmap|path|study|course|plan)\b/.test(q)) {
    const roadmap = (result.roadmap ?? []).filter((i) => i.group !== "maintain");
    if (result.roadmap) {
      return {
        content: roadmap.length
          ? `Your roadmap for this role, in order:\n\n${list(
              roadmap.map((i) => `**${i.skill}** (${RATING[i.status]}, ${i.requirementType}) - ${i.steps.find((st) => st.phase === "build")?.text ?? i.steps[0].text}`)
            )}\n\nAfter each step, re-run the analysis to check the rating changed.`
          : "There are no skill gaps against this job description. Re-run the analysis against a more senior role to find the next steps.",
        sources: ["Career Roadmap"],
        mode: "rules",
      };
    }
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

  if (/\b(require|requirement|asks?\s+for|looking\s+for|job\s+description|jd)\b/.test(q) && result.requirements) {
    return {
      content: `What the job description asks for, as Skill2Hire read it:\n\n${list(
        result.requirements.map((r) => `**${r.label}** (${r.requirementType}) - ${r.typeReason}.`)
      )}`,
      sources: ["Job Description"],
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
    content: `Your analysis is **${result.resumeName}** vs **${result.jdTitle}** (${result.overallScore}/100): ${result.strongSkills.length} strong, ${result.partialSkills.length} partial and ${result.missingSkills.length} missing skills.\n\nYou can ask why a specific skill got its rating, how the score was calculated, what to improve first, what to learn next, or how confident the analysis is.`,
    sources: ["Analysis Summary"],
    mode: "rules",
  };
}

export interface AnswerContext {
  db: Db;
  userId: string;
  /** null = rules only (no GEMINI_API_KEY/GEMINI_MODEL). */
  gemini: GeminiPhraser | null;
  quota: GeminiQuotaLimits;
  now: Date;
}

/**
 * The rules answer is always computed first and is authoritative. Gemini may only reword it (D-9): the request needs a
 * reserved quota unit, the payload is redacted JSON, and the reply must pass validateGeminiAnswer. Otherwise - no
 * Gemini configured, quota used up, an error, a timeout or a failed check - the rules answer is returned silently.
 * Only a reason code is logged; never the question, the evidence or the generated text.
 */
export async function answer(question: string, result: AnalysisResult | null, ctx: AnswerContext): Promise<AssistantReply> {
  const base = answerFromAnalysis(question, result);
  if (!ctx.gemini || !result) return base;

  const quota = await reserveGeminiAnswer(ctx.db, ctx.userId, ctx.quota, ctx.now);
  if (!quota.admitted) {
    console.info(`[assistant] rules answer used: ${quota.reason}`);
    return base;
  }
  try {
    const { payload, contents } = buildGeminiPayload(question, result, base.content);
    const response = await phraseWithGemini(ctx.gemini, contents);
    const checked = validateGeminiAnswer(response, payload, result);
    if (!checked.ok) {
      console.warn(`[assistant] Gemini answer rejected: ${checked.reason}`);
      return base;
    }
    return { content: checked.text, sources: base.sources, mode: "gemini" };
  } catch (err) {
    const code = (err as { name?: string })?.name === "AbortError" || (err as { name?: string })?.name === "TimeoutError" ? "timeout" : "error";
    console.warn(`[assistant] Gemini call failed: ${code}`);
    return base;
  }
}
