import { AlertCircle, CheckCircle2, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { AnalysisResult, Confidence, RecommendationGroup, RoadmapGroup, SkillLevel, SkillStatus } from "@/types";

export const STATUS_LABEL: Record<SkillLevel, string> = { strong: "Strong", partial: "Partial", missing: "Missing" };

export const STATUS_STYLE: Record<SkillLevel, { chip: string; soft: string; text: string }> = {
  strong: { chip: "bg-emerald-50 text-emerald-700 border-emerald-200", soft: "bg-emerald-50", text: "text-emerald-700" },
  partial: { chip: "bg-amber-50 text-amber-800 border-amber-200", soft: "bg-amber-50", text: "text-amber-800" },
  missing: { chip: "bg-rose-50 text-rose-700 border-rose-200", soft: "bg-rose-50", text: "text-rose-700" },
};

export function StatusIcon({ status, className = "w-4 h-4" }: { status: SkillLevel; className?: string }) {
  const props = { className: cn(className, "shrink-0"), "aria-hidden": true };
  if (status === "strong") return <CheckCircle2 {...props} className={cn(props.className, "text-emerald-600")} />;
  if (status === "partial") return <AlertCircle {...props} className={cn(props.className, "text-amber-600")} />;
  return <XCircle {...props} className={cn(props.className, "text-rose-600")} />;
}

export function StatusChip({ status }: { status: SkillLevel }) {
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold", STATUS_STYLE[status].chip)}>
      <StatusIcon status={status} className="w-3 h-3" />
      {STATUS_LABEL[status]}
    </span>
  );
}

const CONFIDENCE_STYLE: Record<Confidence, string> = {
  high: "bg-slate-100 text-slate-700 border-slate-200",
  medium: "bg-sky-50 text-sky-800 border-sky-200",
  low: "bg-orange-50 text-orange-800 border-orange-200",
};

export function ConfidenceChip({ level, label = "confidence" }: { level: Confidence; label?: string }) {
  return (
    <span
      className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium", CONFIDENCE_STYLE[level])}
      title="How clear the evidence behind this is. Not a prediction of hiring outcomes."
    >
      {level.charAt(0).toUpperCase() + level.slice(1)} {label}
    </span>
  );
}

export function RequirementChip({ type }: { type: "required" | "preferred" }) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-2 py-0.5 text-xs font-medium",
        type === "required" ? "border-slate-300 text-slate-700" : "border-dashed border-slate-300 text-slate-500"
      )}
    >
      {type === "required" ? "Required" : "Preferred"}
    </span>
  );
}

export const GROUP_LABEL: Record<RecommendationGroup | RoadmapGroup, string> = {
  "required-missing": "Required skills to add",
  "required-partial": "Required skills to strengthen",
  "preferred-missing": "Preferred skills to add",
  "preferred-partial": "Preferred skills to strengthen",
  other: "Background requirements",
  maintain: "Already strong",
};

/** A quoted line from a document. Plain text only: never rendered as HTML. */
export function Quote({ label, children, tone = "slate" }: { label: string; children: string; tone?: "slate" | "cyan" }) {
  return (
    <figure className={cn("rounded-md border-l-2 pl-3 py-1", tone === "cyan" ? "border-cyan-400" : "border-slate-300")}>
      <figcaption className="text-[11px] uppercase tracking-wide text-slate-500">{label}</figcaption>
      <blockquote className="text-sm text-slate-700 break-words">{children}</blockquote>
    </figure>
  );
}

export const allSkills = (r: AnalysisResult): SkillStatus[] => [...r.strongSkills, ...r.partialSkills, ...r.missingSkills];

/** True for results from engine 2.0 or later (reasons, recommendations and roadmap available). */
export const hasEvidenceDetail = (r: AnalysisResult) => Array.isArray(r.recommendations);

/** Short label for a recommendation's estimated impact on the overall score. */
export const impactLabel = (points: number) => (points <= 0 ? "< 1 pt" : `≈ +${points} pt${points === 1 ? "" : "s"}`);
