import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import type { AnalysisResult, Recommendation, SkillLevel, SkillStatus } from "@/types";
import type { Page } from "@/types";
import {
  allSkills,
  ConfidenceChip,
  GROUP_LABEL,
  hasEvidenceDetail,
  impactLabel,
  Quote,
  RequirementChip,
  STATUS_LABEL,
  StatusChip,
  StatusIcon,
} from "@/components/analysis-ui";
import {
  AlertTriangle,
  BookOpen,
  Calculator,
  ChevronDown,
  FileSearch,
  FlaskConical,
  ListChecks,
  MessageSquare,
  Sparkles,
  Target,
} from "lucide-react";

interface ResultsPageProps {
  result: AnalysisResult;
  onNavigate: (page: Page) => void;
  isGuest: boolean;
  onSignIn: () => void;
}

function ScoreRing({ score }: { score: number }) {
  const r = 52;
  const c = 2 * Math.PI * r;
  const clamped = Math.max(0, Math.min(100, score));
  return (
    <svg viewBox="0 0 120 120" className="w-28 h-28 sm:w-32 sm:h-32 -rotate-90" aria-hidden="true">
      <circle cx="60" cy="60" r={r} fill="none" strokeWidth="10" className="stroke-ink-700" />
      <circle
        cx="60"
        cy="60"
        r={r}
        fill="none"
        strokeWidth="10"
        strokeLinecap="round"
        strokeDasharray={`${(clamped / 100) * c} ${c}`}
        className="stroke-parrot-400 transition-[stroke-dasharray] duration-700"
      />
    </svg>
  );
}

function SkillRow({ skill }: { skill: SkillStatus }) {
  const detail = !!skill.reason;
  return (
    <details className="group rounded-lg border border-slate-200 bg-white open:shadow-sm">
      <summary className="flex cursor-pointer list-none items-center gap-3 p-3 [&::-webkit-details-marker]:hidden">
        <StatusIcon status={skill.status} />
        <span className="font-medium text-slate-900 min-w-0 truncate">{skill.skill}</span>
        <span className="ml-auto flex flex-wrap items-center justify-end gap-1.5">
          <RequirementChip type={skill.requirementType} />
          {skill.confidence && skill.confidence !== "high" && <ConfidenceChip level={skill.confidence} />}
          <ChevronDown className="w-4 h-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
        </span>
      </summary>
      <div className="space-y-3 border-t border-slate-100 px-3 pb-3 pt-3 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <StatusChip status={skill.status} />
          {skill.category && <Badge variant="secondary">{skill.category}</Badge>}
          {skill.confidence && <ConfidenceChip level={skill.confidence} />}
        </div>
        <p className="text-slate-700">
          {detail
            ? skill.reason
            : skill.status === "missing"
              ? "Not found in your resume."
              : skill.status === "strong"
                ? `Demonstrated in your ${skill.section} section.`
                : `Only appears in your ${skill.section} section, not in experience or project work.`}
        </p>
        {skill.jdEvidence && <Quote label="Job description" tone="cyan">{skill.jdEvidence}</Quote>}
        {skill.evidence && <Quote label={`Your resume · ${skill.section ?? "resume"}`}>{skill.evidence}</Quote>}
        {skill.related && skill.related.length > 0 && (
          <div className="rounded-md bg-slate-50 p-3">
            <p className="text-xs font-semibold text-slate-600 mb-1">Related, but not counted</p>
            <ul className="space-y-2">
              {skill.related.map((rel) => (
                <li key={rel.skill} className="text-slate-600">
                  {rel.note}
                  <span className="block text-xs text-slate-500 break-words">
                    {rel.section}: "{rel.evidence}"
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </details>
  );
}

function RecommendationCard({ rec }: { rec: Recommendation }) {
  return (
    <li className="rounded-lg border border-slate-200 bg-white p-4">
      <div className="flex flex-wrap items-start gap-3">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-slate-900 text-sm font-bold text-cyan-400">{rec.priority}</span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h4 className="font-semibold text-slate-900">{rec.target}</h4>
            <RequirementChip type={rec.requirementType} />
          </div>
          <p className="mt-1 text-sm text-slate-600">{rec.gap}</p>
        </div>
        <span
          className="shrink-0 rounded-full bg-cyan-50 px-2.5 py-1 text-xs font-semibold text-cyan-800"
          title={rec.impactNote}
        >
          {impactLabel(rec.impactPoints)}
        </span>
      </div>
      <dl className="mt-4 grid grid-cols-1 gap-3 text-sm md:grid-cols-2">
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Why it matters</dt>
          <dd className="mt-1 space-y-2 text-slate-700">
            <p>{rec.whyItMatters}</p>
            <Quote label="Job description" tone="cyan">{rec.jdEvidence}</Quote>
          </dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Current evidence</dt>
          <dd className="mt-1 text-slate-700">{rec.currentEvidence ? <Quote label="Your resume">{rec.currentEvidence}</Quote> : <span className="text-slate-500">None found</span>}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">What to do</dt>
          <dd className="mt-1 text-slate-700">{rec.action}</dd>
        </div>
        <div>
          <dt className="text-xs font-semibold uppercase tracking-wide text-slate-500">Evidence to add</dt>
          <dd className="mt-1 text-slate-700">{rec.evidenceToAdd}</dd>
        </div>
      </dl>
      <p className="mt-3 text-xs text-slate-500">{rec.impactNote}</p>
    </li>
  );
}

type Filter = "all" | SkillLevel;

export function ResultsPage({ result, onNavigate, isGuest, onSignIn }: ResultsPageProps) {
  const [filter, setFilter] = useState<Filter>("all");
  const skills = allSkills(result);
  const required = skills.filter((s) => s.requirementType === "required");
  const requiredPresent = required.filter((s) => s.status !== "missing").length;
  const detail = hasEvidenceDetail(result);
  const recommendations = result.recommendations ?? [];
  const critical = recommendations.filter((r) => r.requirementType === "required").slice(0, 3);
  const score = Math.round(result.overallScore);

  const rows = result.components.map((c) => ({ ...c, points: c.contribution ?? Math.round(c.score * c.weight * 10) / 10 }));
  const pointsTotal = Math.round(rows.reduce((s, c) => s + c.points, 0) * 10) / 10;

  const grouped = useMemo(() => {
    const groups = new Map<Recommendation["group"], Recommendation[]>();
    for (const r of recommendations) groups.set(r.group, [...(groups.get(r.group) ?? []), r]);
    return [...groups.entries()];
  }, [recommendations]);

  const visible = filter === "all" ? skills : skills.filter((s) => s.status === filter);
  const counts: Record<Filter, number> = {
    all: skills.length,
    strong: result.strongSkills.length,
    partial: result.partialSkills.length,
    missing: result.missingSkills.length,
  };

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      {/* Header */}
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Analysis Results</h1>
            {result.demo && (
              <Badge className="bg-cyan-100 text-cyan-800">
                <FlaskConical className="mr-1 h-3 w-3" aria-hidden="true" />
                Sample
              </Badge>
            )}
          </div>
          <p className="mt-1 break-words text-slate-600">
            {result.resumeName} vs <span className="font-medium text-slate-800">{result.jdTitle}</span>
          </p>
        </div>
        <Badge variant="outline" className="text-slate-500">
          {result.demo ? "Synthetic documents · not saved" : new Date(result.analyzedAt).toLocaleDateString()}
        </Badge>
      </div>

      {result.demo && (
        <div role="note" className="mb-6 flex flex-col gap-3 rounded-lg border border-cyan-200 bg-cyan-50 p-4 text-sm text-cyan-900 sm:flex-row sm:items-center">
          <FlaskConical className="hidden h-5 w-5 shrink-0 sm:block" aria-hidden="true" />
          <p className="flex-1">
            This sample compares a synthetic resume with a fictional job description. The numbers below are computed live by the
            same engine that analyses your own resume.
          </p>
          <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => onNavigate("analysis")}>
            Analyze my resume
          </Button>
        </div>
      )}

      {/* Score */}
      <Card className="mb-6 border-0 bg-gradient-to-br from-ink-900 to-ink-800 text-ink-50">
        <CardContent className="p-6 sm:p-8">
          <div className="flex flex-col-reverse gap-6 sm:flex-row sm:items-center sm:justify-between">
            <div className="min-w-0">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">Match score</p>
              <div className="flex items-end gap-2">
                <span className="font-display text-5xl font-bold sm:text-6xl">{score}</span>
                <span className="mb-2 text-xl text-ink-300">/ 100</span>
              </div>
              <p className="mt-3 text-ink-100">
                {result.strongSkills.length} strong · {result.partialSkills.length} partial · {result.missingSkills.length} missing
                {required.length > 0 && (
                  <>
                    {" "}
                    · <span className="font-semibold text-ink-50">{requiredPresent} of {required.length}</span> required skills present
                  </>
                )}
              </p>
              <p className="mt-2 max-w-xl text-sm text-ink-300">
                The score reflects what your resume shows against this job description. It isn't a prediction of a hiring decision.
              </p>
              {result.confidence && (
                <details className="mt-4 max-w-xl">
                  <summary className="cursor-pointer text-sm text-parrot-300 hover:text-parrot-200">
                    {result.confidence.level.charAt(0).toUpperCase() + result.confidence.level.slice(1)} confidence - why?
                  </summary>
                  <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-ink-200">
                    {result.confidence.reasons.map((r) => (
                      <li key={r}>{r}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <div className="relative flex shrink-0 items-center justify-center self-start sm:self-auto">
              <ScoreRing score={score} />
              <span className="absolute text-2xl font-bold">{score}%</span>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Critical gaps */}
      {detail && (
        <Card className="mb-6 border-slate-200 bg-white shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <AlertTriangle className="h-5 w-5 text-rose-600" aria-hidden="true" />
              Critical gaps
            </CardTitle>
          </CardHeader>
          <CardContent>
            {critical.length === 0 ? (
              <p className="text-sm text-slate-600">No required gaps: every required skill and background requirement that could be checked is covered.</p>
            ) : (
              <ol className="grid grid-cols-1 gap-3 md:grid-cols-3">
                {critical.map((r) => (
                  <li key={r.target} className="rounded-lg border border-rose-100 bg-rose-50/60 p-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-slate-900">
                        {r.priority}. {r.target}
                      </span>
                      <span className="text-xs font-semibold text-cyan-800" title={r.impactNote}>
                        {impactLabel(r.impactPoints)}
                      </span>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{r.gap}</p>
                  </li>
                ))}
              </ol>
            )}
            {recommendations.length > 0 && (
              <a href="#why-not-me" className="mt-4 inline-block text-sm font-medium text-cyan-700 hover:underline">
                See all {recommendations.length} recommendations
              </a>
            )}
          </CardContent>
        </Card>
      )}

      {/* Score breakdown */}
      <Card className="mb-6 border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Calculator className="h-5 w-5 text-cyan-600" aria-hidden="true" />
            How your score was calculated
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[520px] text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-xs uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-4 font-semibold">Component</th>
                  <th className="py-2 pr-4 font-semibold">Score</th>
                  <th className="py-2 pr-4 font-semibold">Weight</th>
                  <th className="py-2 text-right font-semibold">Points</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((c) => (
                  <tr key={c.name} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium text-slate-900">{c.name}</span>
                        {c.confidence && c.confidence !== "high" && <ConfidenceChip level={c.confidence} />}
                      </div>
                      <p className="mt-1 max-w-xl text-xs text-slate-500">{c.description}</p>
                    </td>
                    <td className="w-36 py-3 pr-4">
                      <div className="flex items-center gap-2">
                        <Progress value={c.score} className="h-1.5 w-16" aria-label={`${c.name} score`} />
                        <span className="tabular-nums text-slate-700">{Math.round(c.score)}</span>
                      </div>
                    </td>
                    <td className="py-3 pr-4 tabular-nums text-slate-700">{Math.round(c.weight * 100)}%</td>
                    <td className="py-3 text-right font-semibold tabular-nums text-slate-900">{c.points.toFixed(1)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className="pt-3 font-semibold text-slate-900" colSpan={3}>
                    Overall (rounded)
                  </td>
                  <td className="pt-3 text-right text-lg font-bold tabular-nums text-slate-900">{score}</td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="mt-3 text-xs text-slate-500">
            Points = score x weight. Points add up to {pointsTotal.toFixed(1)}, shown rounded to a whole number. Weights are
            shared out over the components that could be assessed.
          </p>
          {result.notAssessed.length > 0 && (
            <div className="mt-4 rounded-lg bg-slate-100 p-3 text-sm text-slate-600">
              <p className="mb-1 font-medium text-slate-700">Not scored</p>
              <ul className="list-disc space-y-0.5 pl-5">
                {result.notAssessed.map((item) => (
                  <li key={item}>{item}</li>
                ))}
              </ul>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Skills */}
      <Card className="mb-6 border-slate-200 bg-white shadow-sm">
        <CardHeader className="gap-3">
          <CardTitle className="flex items-center gap-2 text-lg">
            <ListChecks className="h-5 w-5 text-cyan-600" aria-hidden="true" />
            Skills from the job description
          </CardTitle>
          <div role="group" aria-label="Filter skills" className="flex flex-wrap gap-2">
            {(["all", "strong", "partial", "missing"] as Filter[]).map((f) => (
              <button
                key={f}
                type="button"
                aria-pressed={filter === f}
                onClick={() => setFilter(f)}
                className={cn(
                  "rounded-full border px-3 py-1 text-sm transition-colors",
                  filter === f ? "border-slate-900 bg-slate-900 text-white" : "border-slate-200 text-slate-600 hover:border-slate-300"
                )}
              >
                {f === "all" ? "All" : STATUS_LABEL[f]} ({counts[f]})
              </button>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <p className="mb-3 text-sm text-slate-500">
            <strong className="text-slate-700">Strong</strong>: used in Experience or Projects. <strong className="text-slate-700">Partial</strong>: only listed
            elsewhere. <strong className="text-slate-700">Missing</strong>: not found. Open a skill to see the evidence.
          </p>
          {visible.length === 0 ? (
            <p className="text-sm text-slate-500">None</p>
          ) : (
            <div className="space-y-2">
              {visible.map((s) => (
                <SkillRow key={s.skill} skill={s} />
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Why not me */}
      <Card id="why-not-me" className="mb-6 scroll-mt-20 border-slate-200 bg-white shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-lg">
            <Target className="h-5 w-5 text-cyan-600" aria-hidden="true" />
            Why not me?
          </CardTitle>
        </CardHeader>
        <CardContent>
          {detail ? (
            <>
              {result.strongSkills.length > 0 && (
                <div className="mb-5">
                  <h3 className="mb-2 text-sm font-semibold text-emerald-700">What you already show</h3>
                  <div className="flex flex-wrap gap-2">
                    {result.strongSkills.map((s) => (
                      <span key={s.skill} className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">
                        {s.skill}
                      </span>
                    ))}
                  </div>
                </div>
              )}
              {grouped.length === 0 ? (
                <p className="text-sm text-slate-600">Nothing to add: every recognised requirement is already shown with applied evidence.</p>
              ) : (
                <div className="space-y-6">
                  {grouped.map(([group, recs]) => (
                    <section key={group}>
                      <h3 className="mb-2 text-sm font-semibold text-slate-700">{GROUP_LABEL[group]}</h3>
                      <ol className="space-y-3">
                        {recs.map((r) => (
                          <RecommendationCard key={r.target} rec={r} />
                        ))}
                      </ol>
                    </section>
                  ))}
                </div>
              )}
              <p className="mt-4 text-xs text-slate-500">
                Impact estimates come from the scoring weights above. Only add claims you can back up.
              </p>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              {(
                [
                  ["What you already have", result.whyNotMe.strengths, "strong"],
                  ["What is missing", result.whyNotMe.gaps, "missing"],
                  ["What is weakly supported", result.whyNotMe.weakSupport, "partial"],
                  ["What would improve your match", result.whyNotMe.improvements, null],
                ] as const
              ).map(([title, items, status]) => (
                <div key={title}>
                  <h4 className="mb-3 font-semibold text-slate-800">{title}</h4>
                  <ul className="space-y-2">
                    {items.length === 0 && <li className="text-sm text-slate-400">Nothing here</li>}
                    {items.map((item, i) => (
                      <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                        {status ? <StatusIcon status={status} className="mt-0.5 h-4 w-4" /> : <Sparkles className="mt-0.5 h-4 w-4 shrink-0 text-cyan-500" aria-hidden="true" />}
                        {item}
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Requirements as read */}
      {result.requirements && result.requirements.length > 0 && (
        <details className="group mb-6 rounded-xl border border-slate-200 bg-white shadow-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-6 [&::-webkit-details-marker]:hidden">
            <FileSearch className="h-5 w-5 text-cyan-600" aria-hidden="true" />
            <span className="text-lg font-semibold text-slate-900">How the job description was read</span>
            <span className="text-sm text-slate-500">({result.requirements.length} requirements)</span>
            <ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="space-y-3 px-6 pb-6">
            {result.requirements.map((r) => (
              <li key={r.id} className="rounded-lg border border-slate-100 p-3">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium text-slate-900">{r.label}</span>
                  <Badge variant="secondary">{r.category}</Badge>
                  <RequirementChip type={r.requirementType} />
                  {r.confidence !== "high" && <ConfidenceChip level={r.confidence} />}
                </div>
                <p className="mt-1 text-sm text-slate-600">{r.typeReason}.</p>
                <div className="mt-2">
                  <Quote label="Job description" tone="cyan">{r.jdEvidence}</Quote>
                </div>
              </li>
            ))}
          </ul>
        </details>
      )}

      {isGuest && !result.demo && (
        <Card className="mb-6 border-cyan-200 bg-cyan-50">
          <CardContent className="flex flex-col gap-4 p-6 md:flex-row md:items-center">
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900">Save this result and keep going</h3>
              <p className="text-sm text-slate-600">
                This was your free analysis. Create an account (or continue with Google) to keep it in your history, chat with the
                Career Assistant and run more analyses.
              </p>
            </div>
            <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={onSignIn}>
              Create free account
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Next steps */}
      <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
        <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => onNavigate("assistant")}>
          <MessageSquare className="mr-2 h-4 w-4" aria-hidden="true" />
          {result.demo ? "Ask about this sample" : "Ask Career Assistant"}
        </Button>
        <Button variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-50" onClick={() => onNavigate("roadmap")}>
          <BookOpen className="mr-2 h-4 w-4" aria-hidden="true" />
          View Career Roadmap
        </Button>
        {result.demo && (
          <Button variant="outline" className="border-slate-300 text-slate-700 hover:bg-slate-50" onClick={() => onNavigate("analysis")}>
            Analyze my own resume
          </Button>
        )}
      </div>
    </div>
  );
}
