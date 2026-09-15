import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import type { AnalysisResult, Page } from "@/types";
import { impactLabel, StatusIcon, STATUS_LABEL } from "@/components/analysis-ui";
import { ArrowRight, Calculator, FileSearch, FlaskConical, ListChecks, Loader2, Map as MapIcon, ScanSearch, ShieldCheck, Scale } from "lucide-react";

interface HomePageProps {
  onNavigate: (page: Page) => void;
  onOpenDemo: (result: AnalysisResult) => void;
  hasAnalysis: boolean;
  isGuest: boolean;
}

const STEPS = [
  {
    icon: FileSearch,
    title: "Read the job description",
    desc: "Splits it into required and preferred skills, years of experience, degree and certifications, and records the sentence each came from.",
  },
  {
    icon: ScanSearch,
    title: "Find evidence in your resume",
    desc: "A skill used in your Experience or Projects is Strong, one that is only listed is Partial, and one that isn't there is Missing. Related tools never count as a match.",
  },
  {
    icon: Calculator,
    title: "Score it transparently",
    desc: "Six weighted components - skills, wording, experience, education, projects, certifications - with the points each adds shown in a breakdown.",
  },
  {
    icon: MapIcon,
    title: "Plan what to do next",
    desc: "Prioritised recommendations with their estimated score impact, and a learn → build → demonstrate roadmap you can re-check.",
  },
];

function HeroPreview({ result, loading }: { result: AnalysisResult | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-slate-700 bg-slate-800/60" aria-label="Loading sample analysis">
        <Loader2 className="h-6 w-6 animate-spin text-cyan-400" aria-hidden="true" />
      </div>
    );
  }
  if (!result) return null;
  const featured = [
    ...result.strongSkills.slice(0, 1),
    ...result.partialSkills.slice(0, 1),
    ...result.missingSkills.filter((s) => s.related?.length).slice(0, 1),
  ];
  const top = result.recommendations?.[0];
  return (
    <figure className="rounded-2xl border border-slate-700 bg-slate-800/60 p-5 text-sm shadow-xl">
      <figcaption className="mb-4 flex items-center justify-between gap-2 text-xs text-slate-400">
        <span className="flex items-center gap-1">
          <FlaskConical className="h-3.5 w-3.5 text-cyan-400" aria-hidden="true" />
          Live output · synthetic sample
        </span>
        <span className="truncate">{result.jdTitle}</span>
      </figcaption>
      <div className="flex items-end gap-2">
        <span className="text-4xl font-bold text-white">{Math.round(result.overallScore)}</span>
        <span className="mb-1 text-slate-400">/ 100 match</span>
      </div>
      <p className="mt-1 text-slate-400">
        {result.strongSkills.length} strong · {result.partialSkills.length} partial · {result.missingSkills.length} missing
      </p>
      <ul className="mt-4 space-y-3">
        {featured.map((s) => (
          <li key={s.skill} className="rounded-lg bg-slate-900/70 p-3">
            <div className="flex items-center gap-2">
              <StatusIcon status={s.status} />
              <span className="font-medium text-white">{s.skill}</span>
              <span className="ml-auto text-xs text-slate-400">{STATUS_LABEL[s.status]}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-slate-300">{s.reason ?? s.evidence}</p>
          </li>
        ))}
      </ul>
      {top && (
        <p className="mt-4 border-t border-slate-700 pt-3 text-xs text-slate-300">
          <span className="font-semibold text-cyan-300">First step:</span> {top.target} ·{" "}
          {impactLabel(top.impactPoints)}
        </p>
      )}
    </figure>
  );
}

export function HomePage({ onNavigate, onOpenDemo, hasAnalysis, isGuest }: HomePageProps) {
  const [demo, setDemo] = useState<AnalysisResult | null>(null);
  const [demoState, setDemoState] = useState<"loading" | "ready" | "error">("loading");
  const [opening, setOpening] = useState(false);
  const [openError, setOpenError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    api
      .demoAnalysis()
      .then(({ result }) => {
        if (!active) return;
        setDemo(result);
        setDemoState("ready");
      })
      .catch(() => active && setDemoState("error"));
    return () => {
      active = false;
    };
  }, []);

  const openDemo = async () => {
    if (demo) return onOpenDemo(demo);
    setOpening(true);
    setOpenError(null);
    try {
      const { result } = await api.demoAnalysis();
      onOpenDemo(result);
    } catch {
      setDemoState("error");
      setOpenError("The sample analysis couldn't be loaded. Check your connection and try again.");
    } finally {
      setOpening(false);
    }
  };

  return (
    <div className="min-h-full">
      {/* Hero */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-16">
          <div>
            <div className="mb-6 inline-flex items-center gap-2 rounded-full bg-cyan-500/10 px-4 py-1.5 text-sm text-cyan-300">
              <Scale className="h-4 w-4" aria-hidden="true" />
              Explainable resume-to-job matching
            </div>
            <h1 className="mb-4 text-3xl font-bold leading-tight sm:text-4xl lg:text-5xl">
              See how your resume matches a job,
              <span className="text-cyan-400"> with the evidence.</span>
            </h1>
            <p className="mb-8 max-w-2xl text-base text-slate-300 sm:text-lg">
              Skill2Hire rates each skill a job description asks for as Strong, Partial or Missing, shows the resume line and the job
              description sentence behind every rating, and turns the gaps into a prioritised plan. The scoring is rule-based, so
              every number can be traced.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button size="lg" className="bg-cyan-500 text-slate-900 hover:bg-cyan-400" onClick={openDemo} disabled={opening}>
                {opening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />}
                Try Demo Analysis
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-slate-600 bg-transparent text-white hover:bg-slate-800 hover:text-white"
                onClick={() => onNavigate("analysis")}
              >
                {isGuest && !hasAnalysis ? "Analyze my resume free" : "Start New Analysis"}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
              {hasAnalysis && (
                <Button size="lg" variant="ghost" className="text-slate-300 hover:bg-slate-800 hover:text-white" onClick={() => onNavigate("results")}>
                  View latest results
                </Button>
              )}
            </div>
            {openError && (
              <p role="alert" className="mt-3 text-sm text-rose-300">
                {openError}
              </p>
            )}
            <p className="mt-4 text-xs text-slate-400">
              The demo uses a synthetic resume and a fictional job, analysed live. No upload or account needed.
            </p>
          </div>
          {demoState !== "error" && <HeroPreview result={demo} loading={demoState === "loading"} />}
        </div>
      </div>

      {/* How it works */}
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="mb-2 text-2xl font-bold text-slate-900">How it works</h2>
        <p className="mb-8 max-w-3xl text-slate-600">
          Everything below runs as deterministic rules on the server. If AI phrasing is switched on for the Career Assistant, it can only
          reword answers - it never changes a score, a rating or the evidence.
        </p>
        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title}>
                <Card className="h-full border-slate-200 bg-white shadow-sm">
                  <CardContent className="p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-900">
                        <Icon className="h-5 w-5 text-cyan-400" aria-hidden="true" />
                      </div>
                      <span className="text-sm font-semibold text-slate-400">Step {i + 1}</span>
                    </div>
                    <h3 className="mb-2 font-semibold text-slate-900">{step.title}</h3>
                    <p className="text-sm text-slate-600">{step.desc}</p>
                  </CardContent>
                </Card>
              </li>
            );
          })}
        </ol>
      </div>

      {/* Principles */}
      <div className="border-t border-slate-200 bg-white">
        <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
          <h2 className="mb-8 text-2xl font-bold text-slate-900">What you can rely on</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            <Card className="border-slate-200 bg-slate-50">
              <CardContent className="p-6">
                <ListChecks className="mb-4 h-8 w-8 text-cyan-600" aria-hidden="true" />
                <h3 className="mb-2 font-semibold text-slate-900">Evidence for every rating</h3>
                <p className="text-sm text-slate-600">
                  Each rating quotes the resume line and job description sentence it is based on, with a confidence level when the
                  evidence is unclear.
                </p>
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-slate-50">
              <CardContent className="p-6">
                <Scale className="mb-4 h-8 w-8 text-cyan-600" aria-hidden="true" />
                <h3 className="mb-2 font-semibold text-slate-900">Honest about limits</h3>
                <p className="text-sm text-slate-600">
                  It measures what your resume shows, not how well you know a skill, and it can't predict a hiring decision. Anything
                  it can't check is marked as not scored.
                </p>
              </CardContent>
            </Card>
            <Card className="border-slate-200 bg-slate-50">
              <CardContent className="p-6">
                <ShieldCheck className="mb-4 h-8 w-8 text-cyan-600" aria-hidden="true" />
                <h3 className="mb-2 font-semibold text-slate-900">Your data</h3>
                <p className="text-sm text-slate-600">
                  Uploaded files are read in memory and not stored; only the analysis result is saved, and you can delete it. When AI
                  phrasing is on, the assistant sends analysis facts with contact details removed to Google Gemini.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}
