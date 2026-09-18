import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { api } from "@/lib/api";
import { useReveal } from "@/hooks/useReveal";
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

const PRINCIPLES = [
  {
    icon: ListChecks,
    title: "Evidence for every rating",
    desc: "Each rating quotes the resume line and job description sentence it is based on, with a confidence level when the evidence is unclear.",
  },
  {
    icon: Scale,
    title: "Honest about limits",
    desc: "It measures what your resume shows, not how well you know a skill, and it can't predict a hiring decision. Anything it can't check is marked as not scored.",
  },
  {
    icon: ShieldCheck,
    title: "Your data",
    desc: "Uploaded files are read in memory and not stored; only the analysis result is saved, and you can delete it. When AI phrasing is on, the assistant sends analysis facts with contact details removed to Google Gemini.",
  },
];

/** The sample result, shown on a dark card so it reads as real output in both themes. */
function HeroPreview({ result, loading }: { result: AnalysisResult | null; loading: boolean }) {
  if (loading) {
    return (
      <div className="flex h-72 items-center justify-center rounded-2xl border border-ink-700 bg-ink-900" aria-label="Loading sample analysis">
        <Loader2 className="h-6 w-6 animate-spin text-parrot-400" aria-hidden="true" />
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
    <figure className="animate-float rounded-2xl border border-ink-700 bg-ink-900 p-5 text-sm text-ink-100 shadow-xl">
      <figcaption className="mb-4 flex items-center justify-between gap-2 text-xs text-ink-300">
        <span className="flex items-center gap-1.5">
          <span className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-parrot-400" aria-hidden="true" />
          Live output · synthetic sample
        </span>
        <span className="truncate">{result.jdTitle}</span>
      </figcaption>
      <div className="flex items-end gap-2">
        <span className="font-display text-4xl font-bold text-ink-50">{Math.round(result.overallScore)}</span>
        <span className="mb-1 text-ink-300">/ 100 match</span>
      </div>
      <p className="mt-1 text-ink-300">
        {result.strongSkills.length} strong · {result.partialSkills.length} partial · {result.missingSkills.length} missing
      </p>
      <ul className="mt-4 space-y-3">
        {featured.map((s) => (
          <li key={s.skill} className="rounded-lg bg-ink-950/60 p-3">
            <div className="flex items-center gap-2">
              <StatusIcon status={s.status} />
              <span className="font-medium text-ink-50">{s.skill}</span>
              <span className="ml-auto text-xs text-ink-300">{STATUS_LABEL[s.status]}</span>
            </div>
            <p className="mt-1 line-clamp-2 text-xs text-ink-200">{s.reason ?? s.evidence}</p>
          </li>
        ))}
      </ul>
      {top && (
        <p className="mt-4 border-t border-ink-700 pt-3 text-xs text-ink-200">
          <span className="font-semibold text-parrot-300">First step:</span> {top.target} · {impactLabel(top.impactPoints)}
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
  useReveal([demoState]);

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
      <div className="relative overflow-hidden bg-gradient-to-br from-slate-50 via-cyan-50 to-slate-100">
        {/* Slowly drifting glows; decorative only. */}
        <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
          <div className="animate-drift absolute -left-24 -top-24 h-72 w-72 rounded-full bg-cyan-300/30 blur-3xl" />
          <div className="animate-float-slow absolute right-[-6rem] top-24 h-80 w-80 rounded-full bg-emerald-300/20 blur-3xl" />
          <div className="animate-drift absolute bottom-[-8rem] left-1/3 h-72 w-72 rounded-full bg-cyan-200/30 blur-3xl [animation-delay:3s]" />
        </div>

        <div className="relative mx-auto grid max-w-6xl grid-cols-1 items-center gap-10 px-4 py-12 sm:px-6 lg:grid-cols-[1.1fr_0.9fr] lg:px-8 lg:py-16">
          <div className="reveal">
            <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-cyan-200 bg-white/70 px-4 py-1.5 text-sm text-cyan-800 backdrop-blur">
              <Scale className="h-4 w-4" aria-hidden="true" />
              Explainable resume-to-job matching
            </div>
            <h1 className="mb-4 text-3xl font-bold leading-tight text-slate-900 sm:text-4xl lg:text-5xl">
              See how your resume matches a job,{" "}
              <span className="animate-shimmer bg-gradient-to-r from-cyan-600 via-emerald-500 to-cyan-600 bg-[length:200%_auto] bg-clip-text text-transparent">
                with the evidence.
              </span>
            </h1>
            <p className="mb-8 max-w-2xl text-base text-slate-600 sm:text-lg">
              Skill2Hire rates each skill a job description asks for as Strong, Partial or Missing, shows the resume line and the job
              description sentence behind every rating, and turns the gaps into a prioritised plan. The scoring is rule-based, so
              every number can be traced.
            </p>
            <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
              <Button
                size="lg"
                className="bg-parrot-500 text-ink-950 shadow-lg shadow-parrot-500/20 transition-transform hover:-translate-y-0.5 hover:bg-parrot-400"
                onClick={openDemo}
                disabled={opening}
              >
                {opening ? <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden="true" /> : <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />}
                Try Demo Analysis
              </Button>
              <Button
                size="lg"
                variant="outline"
                className="border-slate-300 bg-white/70 text-slate-900 backdrop-blur transition-transform hover:-translate-y-0.5 hover:bg-white"
                onClick={() => onNavigate("analysis")}
              >
                {isGuest && !hasAnalysis ? "Analyze my resume free" : "Start New Analysis"}
                <ArrowRight className="ml-2 h-4 w-4" aria-hidden="true" />
              </Button>
              {hasAnalysis && (
                <Button size="lg" variant="ghost" className="text-slate-700 hover:bg-slate-200/60 hover:text-slate-900" onClick={() => onNavigate("results")}>
                  View latest results
                </Button>
              )}
            </div>
            {openError && (
              <p role="alert" className="mt-3 text-sm text-rose-700">
                {openError}
              </p>
            )}
            <p className="mt-4 text-xs text-slate-500">
              The demo uses a synthetic resume and a fictional job, analysed live. No upload or account needed.
            </p>
          </div>
          {demoState !== "error" && (
            <div className="reveal [transition-delay:150ms]">
              <HeroPreview result={demo} loading={demoState === "loading"} />
            </div>
          )}
        </div>
      </div>

      {/* How it works */}
      <div className="mx-auto max-w-6xl px-4 py-12 sm:px-6 lg:px-8">
        <h2 className="reveal mb-2 text-2xl font-bold text-slate-900">How it works</h2>
        <p className="reveal mb-8 max-w-3xl text-slate-600">
          Everything below runs as deterministic rules on the server. If AI phrasing is switched on for the Career Assistant, it can only
          reword answers - it never changes a score, a rating or the evidence.
        </p>
        <ol className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
          {STEPS.map((step, i) => {
            const Icon = step.icon;
            return (
              <li key={step.title} className="reveal" style={{ transitionDelay: `${i * 90}ms` }}>
                <Card className="h-full border-slate-200 bg-white shadow-sm transition-transform duration-200 hover:-translate-y-1 hover:shadow-md">
                  <CardContent className="p-6">
                    <div className="mb-4 flex items-center gap-3">
                      <div className="flex h-11 w-11 items-center justify-center rounded-xl bg-ink-900">
                        <Icon className="h-5 w-5 text-parrot-400" aria-hidden="true" />
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
          <h2 className="reveal mb-8 text-2xl font-bold text-slate-900">What you can rely on</h2>
          <div className="grid grid-cols-1 gap-6 md:grid-cols-3">
            {PRINCIPLES.map((item, i) => {
              const Icon = item.icon;
              return (
                <Card key={item.title} className="reveal border-slate-200 bg-slate-50" style={{ transitionDelay: `${i * 90}ms` }}>
                  <CardContent className="p-6">
                    <Icon className="mb-4 h-8 w-8 text-cyan-600" aria-hidden="true" />
                    <h3 className="mb-2 font-semibold text-slate-900">{item.title}</h3>
                    <p className="text-sm text-slate-600">{item.desc}</p>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
