import type { AnalysisResult, SkillLevel } from "../analysis/types.js";
import { GEMINI_STOP, type GeminiPayload, type GeminiResponse } from "./gemini.js";

/**
 * Output checks for a Gemini answer (security remediation P1, D-9). Any failure discards the answer and the rules
 * answer is used instead; only the reason code is logged. The checks catch changed or invented numbers, a named skill
 * given a different Strong/Partial/Missing rating in the same sentence, invented quotes and links. They can't catch
 * every paraphrased contradiction (e.g. "you have never used Python" without a rating word).
 */
export const MAX_GEMINI_ANSWER_CHARS = 4000;

export type ValidationResult = { ok: true; text: string } | { ok: false; reason: ValidationReason };
export type ValidationReason = "finish_reason" | "empty" | "too_long" | "url" | "number" | "rating" | "quote";

const URL_PATTERN = /\b(?:https?|ftp):\/\/|\bwww\.|\b[a-z0-9-]+(?:\.[a-z0-9-]+)*\.(?:com|org|io|dev|app|ai|edu|gov|co|in|me|info)(?:\/|\b)/i;
// Numbers not glued to letters (so "ES6", "S3" or "C++17"-style names aren't read as numbers), with an optional %.
const NUMBER_PATTERN = /(?<![A-Za-z0-9_.])\d+(?:\.\d+)?(?![A-Za-z0-9_])/g;
const RATING_PATTERN = /\b(strong|partial|missing)\b/gi;
const QUOTE_PATTERN = /["“”]([^"“”]+)["“”]/g;

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const squash = (s: string) => s.replace(/\s+/g, " ").trim();

function collectStrings(value: unknown, out: string[] = []): string[] {
  if (typeof value === "string") out.push(value);
  else if (typeof value === "number") out.push(String(value));
  else if (Array.isArray(value)) value.forEach((v) => collectStrings(v, out));
  else if (value && typeof value === "object") Object.values(value).forEach((v) => collectStrings(v, out));
  return out;
}

/** Every number that may appear in an answer: numbers in the facts and draft, plus their integer and 1-decimal rounding. */
function allowedNumbers(sources: string[]): Set<number> {
  const allowed = new Set<number>();
  for (const source of sources) {
    for (const m of source.matchAll(NUMBER_PATTERN)) {
      const n = Number(m[0]);
      allowed.add(n);
      allowed.add(Math.round(n));
      allowed.add(Math.round(n * 10) / 10);
    }
  }
  return allowed;
}

export function validateGeminiAnswer(response: GeminiResponse, payload: GeminiPayload, result: AnalysisResult): ValidationResult {
  if (response.finishReason !== GEMINI_STOP) return { ok: false, reason: "finish_reason" };
  const text = (response.text ?? "").trim();
  if (!text) return { ok: false, reason: "empty" };
  if (text.length > MAX_GEMINI_ANSWER_CHARS) return { ok: false, reason: "too_long" };
  if (URL_PATTERN.test(text)) return { ok: false, reason: "url" };

  const sources = [...collectStrings(payload.analysis_facts), payload.draft_answer];

  const allowed = allowedNumbers(sources);
  for (const m of text.matchAll(NUMBER_PATTERN)) {
    if (!allowed.has(Number(m[0]))) return { ok: false, reason: "number" };
  }

  const ratings = new Map<string, SkillLevel>();
  for (const s of [...result.strongSkills, ...result.partialSkills, ...result.missingSkills]) ratings.set(s.skill, s.status);
  const skillPatterns = [...ratings.keys()].map((skill) => ({
    skill,
    re: new RegExp(`(^|[^a-z0-9+#])${escapeRe(skill.toLowerCase())}($|[^a-z0-9+#])`),
  }));
  for (const sentence of text.split(/(?<=[.!?])\s+|\n+/)) {
    const lower = sentence.toLowerCase();
    const words = [...lower.matchAll(RATING_PATTERN)].map((m) => m[1] as SkillLevel);
    if (!words.length) continue;
    const named = skillPatterns.filter((p) => p.re.test(lower)).map((p) => ratings.get(p.skill)!);
    if (!named.length) continue;
    if (words.some((w) => !named.includes(w))) return { ok: false, reason: "rating" };
  }

  const haystack = squash(sources.join("\n"));
  for (const m of text.matchAll(QUOTE_PATTERN)) {
    if (!haystack.includes(squash(m[1]))) return { ok: false, reason: "quote" };
  }

  return { ok: true, text };
}
