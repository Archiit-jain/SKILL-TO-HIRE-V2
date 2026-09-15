import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import type { AnalysisResult, Page, RoadmapGroup, RoadmapItem, RoadmapStep, SkillStatus } from "@/types";
import { GROUP_LABEL, RequirementChip, StatusChip } from "@/components/analysis-ui";
import { ChevronDown, Hammer, FileText, GraduationCap, Presentation, RefreshCw, Target, ArrowUpRight } from "lucide-react";

interface RoadmapPageProps {
  analysisResult: AnalysisResult | null;
  onNavigate: (page: Page) => void;
}

const PHASE: Record<RoadmapStep["phase"], { label: string; icon: typeof Hammer }> = {
  learn: { label: "Learn", icon: GraduationCap },
  build: { label: "Build", icon: Hammer },
  demonstrate: { label: "Demonstrate", icon: Presentation },
  document: { label: "Document", icon: FileText },
  reanalyze: { label: "Re-analyze", icon: RefreshCw },
};

const GROUP_ORDER: RoadmapGroup[] = ["required-missing", "required-partial", "preferred-missing", "preferred-partial", "maintain"];

/** Analyses saved by engine 1.0 have no roadmap; build the same ordering from their skill lists. */
function legacyRoadmap(r: AnalysisResult): RoadmapItem[] {
  const groupOf = (s: SkillStatus): RoadmapGroup => (s.status === "strong" ? "maintain" : (`${s.requirementType}-${s.status}` as RoadmapGroup));
  const skills = [...r.missingSkills, ...r.partialSkills, ...r.strongSkills].sort(
    (a, b) => GROUP_ORDER.indexOf(groupOf(a)) - GROUP_ORDER.indexOf(groupOf(b))
  );
  return skills.map((s, i) => ({
    order: i + 1,
    skill: s.skill,
    status: s.status,
    requirementType: s.requirementType,
    group: groupOf(s),
    prerequisites: [],
    steps:
      s.status === "strong"
        ? [{ phase: "document", text: `Already demonstrated. Keep ${s.skill} current and state the real outcome of that work.` }]
        : [
            { phase: "learn", text: s.status === "missing" ? `Learn the fundamentals of ${s.skill}.` : `You already list ${s.skill}; refresh what the role needs.` },
            { phase: "build", text: `Use ${s.skill} in a project or a real task.` },
            { phase: "demonstrate", text: `Describe that work in an Experience or Projects bullet that names ${s.skill}.` },
            { phase: "reanalyze", text: "Re-run the analysis with your updated resume." },
          ],
  }));
}

function StepList({ steps }: { steps: RoadmapStep[] }) {
  return (
    <ol className="mt-4 space-y-3">
      {steps.map((step) => {
        const { label, icon: Icon } = PHASE[step.phase];
        return (
          <li key={step.phase} className="flex gap-3">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100">
              <Icon className="h-4 w-4 text-slate-600" aria-hidden="true" />
            </span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold text-slate-800">{label}</p>
              <p className="break-words text-slate-600">{step.text}</p>
            </div>
          </li>
        );
      })}
    </ol>
  );
}

function ItemCard({ item }: { item: RoadmapItem }) {
  return (
    <li className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
      <div className="flex items-start gap-3 sm:gap-4">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900 text-lg font-bold text-cyan-400 sm:h-12 sm:w-12">
          {item.order}
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h3 className="font-semibold text-slate-900">{item.skill}</h3>
            <StatusChip status={item.status} />
            <RequirementChip type={item.requirementType} />
          </div>
          {item.prerequisites.length > 0 && (
            <p className="mt-1 text-xs text-slate-500">Do first: {item.prerequisites.join(", ")}</p>
          )}
          {item.movedEarlierFor && (
            <p className="mt-1 flex items-center gap-1 text-xs text-cyan-700">
              <ArrowUpRight className="h-3 w-3" aria-hidden="true" />
              Moved earlier because {item.movedEarlierFor} builds on it
            </p>
          )}
          <StepList steps={item.steps} />
        </div>
      </div>
    </li>
  );
}

export function RoadmapPage({ analysisResult, onNavigate }: RoadmapPageProps) {
  if (!analysisResult) {
    return (
      <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Career Roadmap</h1>
        <Card className="mt-6 border-slate-200 bg-white shadow-sm">
          <CardContent className="p-8 text-center sm:p-12">
            <Target className="mx-auto mb-4 h-12 w-12 text-slate-300" aria-hidden="true" />
            <h2 className="mb-2 text-lg font-semibold text-slate-900">No analysis yet</h2>
            <p className="mb-6 text-slate-600">Run an analysis first to get a roadmap for that job description.</p>
            <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => onNavigate("analysis")}>
              Start New Analysis
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const items = analysisResult.roadmap ?? legacyRoadmap(analysisResult);
  const gaps = items.filter((i) => i.group !== "maintain");
  const maintain = items.filter((i) => i.group === "maintain");
  // Consecutive runs of the same group, so a prerequisite pulled forward keeps its own label.
  const runs: Array<{ group: RoadmapGroup; items: RoadmapItem[] }> = [];
  for (const item of gaps) {
    const last = runs[runs.length - 1];
    if (last && last.group === item.group) last.items.push(item);
    else runs.push({ group: item.group, items: [item] });
  }

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Career Roadmap</h1>
        <p className="mt-1 text-slate-600">
          For <span className="font-medium text-slate-800">{analysisResult.jdTitle}</span>: required gaps first, then preferred ones. Each
          step says what to do, not how long it takes - that depends on you.
        </p>
      </div>

      {gaps.length === 0 ? (
        <Card className="mb-6 border-slate-200 bg-white shadow-sm">
          <CardContent className="p-6 text-slate-600">
            No skill gaps against this job description. Re-run the analysis against a more senior role to find the next steps.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-8">
          {runs.map((run, i) => (
            <section key={`${run.group}-${i}`}>
              <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-slate-500">{GROUP_LABEL[run.group]}</h2>
              <ol className="space-y-4">
                {run.items.map((item) => (
                  <ItemCard key={item.skill} item={item} />
                ))}
              </ol>
            </section>
          ))}
        </div>
      )}

      {maintain.length > 0 && (
        <details className="group mt-8 rounded-xl border border-slate-200 bg-white">
          <summary className="flex cursor-pointer list-none items-center gap-2 p-4 [&::-webkit-details-marker]:hidden">
            <span className="font-semibold text-slate-900">{GROUP_LABEL.maintain}</span>
            <span className="text-sm text-slate-500">({maintain.length})</span>
            <span className="hidden text-sm text-slate-500 sm:inline">- {maintain.map((m) => m.skill).join(", ")}</span>
            <ChevronDown className="ml-auto h-4 w-4 text-slate-400 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <ul className="space-y-2 px-4 pb-4">
            {maintain.map((item) => (
              <li key={item.skill} className="rounded-lg bg-emerald-50/60 p-3 text-sm">
                <span className="font-medium text-slate-900">{item.skill}</span>
                <span className="text-slate-600"> - {item.steps[0]?.text}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Card className="mt-8 border-0 bg-gradient-to-br from-cyan-500 to-cyan-600 text-white">
        <CardContent className="flex flex-col gap-4 p-6 sm:flex-row sm:items-center">
          <RefreshCw className="hidden h-8 w-8 shrink-0 sm:block" aria-hidden="true" />
          <div className="flex-1">
            <h3 className="mb-1 font-semibold">Re-analyze to check progress</h3>
            <p className="text-sm text-cyan-50">After updating your resume, run the analysis again with the same job description to see which ratings changed.</p>
          </div>
          <Button className="bg-white text-cyan-700 hover:bg-cyan-50" onClick={() => onNavigate("analysis")}>
            Re-analyze
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
