import { useEffect, useMemo, useState } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import type { Page, ProgressEntry } from "@/types";
import { AlertCircle, Briefcase, CheckCircle2, ExternalLink, Loader2, Minus, Trash2, TrendingDown, TrendingUp, XCircle } from "lucide-react";

interface ProgressPageProps {
  onOpenAnalysis: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
  onNavigate: (page: Page) => void;
}

interface RoleGroup {
  key: string;
  title: string;
  /** Oldest first. */
  entries: ProgressEntry[];
}

/** Analyses are grouped by job title (case and spacing ignored); scores are only compared within a group. */
function groupByRole(history: ProgressEntry[]): RoleGroup[] {
  const groups = new Map<string, RoleGroup>();
  for (const entry of [...history].sort((a, b) => a.date.localeCompare(b.date))) {
    const key = entry.jdTitle.trim().replace(/\s+/g, " ").toLowerCase();
    const group = groups.get(key) ?? { key, title: entry.jdTitle.trim(), entries: [] };
    group.entries.push(entry);
    groups.set(key, group);
  }
  // Most recently analysed role first.
  return [...groups.values()].sort((a, b) => b.entries[b.entries.length - 1].date.localeCompare(a.entries[a.entries.length - 1].date));
}

function Change({ entries }: { entries: ProgressEntry[] }) {
  if (entries.length < 2) return <span className="text-xs text-slate-500">Re-analyze to see a change</span>;
  const diff = Math.round(entries[entries.length - 1].score) - Math.round(entries[0].score);
  const Icon = diff > 0 ? TrendingUp : diff < 0 ? TrendingDown : Minus;
  const tone = diff > 0 ? "text-emerald-700 bg-emerald-50" : diff < 0 ? "text-rose-700 bg-rose-50" : "text-slate-600 bg-slate-100";
  return (
    <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold ${tone}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {diff > 0 ? "+" : ""}
      {diff} since first analysis
    </span>
  );
}

export function ProgressPage({ onOpenAnalysis, onDeleted, onNavigate }: ProgressPageProps) {
  const [history, setHistory] = useState<ProgressEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .history()
      .then(({ analyses }) => setHistory(analyses))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load history"));
  }, []);

  const groups = useMemo(() => (history ? groupByRole(history) : []), [history]);

  const handleDelete = async (id: string) => {
    if (!window.confirm("Delete this analysis from your history? This cannot be undone.")) return;
    try {
      await api.deleteAnalysis(id);
      setHistory((prev) => prev?.filter((e) => e.id !== id) ?? null);
      onDeleted(id);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not delete analysis");
    }
  };

  return (
    <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-900 sm:text-3xl">Your Progress</h1>
        <p className="mt-1 text-slate-600">
          Analyses grouped by role. Compare scores within a role: a different job description, even for the same title, can score
          differently.
        </p>
      </div>

      {error && (
        <div role="alert" className="mb-6 rounded-lg border border-rose-200 bg-rose-50 p-4 text-sm text-rose-700">
          {error}
        </div>
      )}

      {history === null && !error && (
        <div className="flex justify-center py-16" aria-label="Loading history">
          <Loader2 className="h-6 w-6 animate-spin text-slate-400" aria-hidden="true" />
        </div>
      )}

      {history?.length === 0 && (
        <Card className="border-slate-200 bg-white shadow-sm">
          <CardContent className="p-8 text-center text-slate-600 sm:p-12">
            <p className="mb-4">No saved analyses yet. Your score history appears here after your first analysis.</p>
            <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => onNavigate("analysis")}>
              Start New Analysis
            </Button>
          </CardContent>
        </Card>
      )}

      <div className="space-y-6">
        {groups.map((group) => {
          const latest = group.entries[group.entries.length - 1];
          return (
            <Card key={group.key} className="border-slate-200 bg-white shadow-sm">
              <CardContent className="p-4 sm:p-6">
                <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-start gap-3">
                    <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-slate-900">
                      <Briefcase className="h-5 w-5 text-cyan-400" aria-hidden="true" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="break-words font-semibold text-slate-900">{group.title}</h2>
                      <p className="text-sm text-slate-500">
                        {group.entries.length} {group.entries.length === 1 ? "analysis" : "analyses"} · latest{" "}
                        {new Date(latest.date).toLocaleDateString()}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p>
                      <span className="text-2xl font-bold text-slate-900">{Math.round(latest.score)}</span>
                      <span className="text-sm text-slate-400"> / 100</span>
                    </p>
                    <Change entries={group.entries} />
                  </div>
                </div>

                <ol className="space-y-3">
                  {[...group.entries].reverse().map((entry) => (
                    <li key={entry.id} className="rounded-lg bg-slate-50 p-3">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-slate-800">{entry.resumeName}</p>
                          <p className="text-xs text-slate-500">{new Date(entry.date).toLocaleString()}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <Progress value={entry.score} className="h-1.5 w-20" aria-label="Score" />
                          <span className="w-8 text-right text-sm font-semibold tabular-nums text-slate-900">{Math.round(entry.score)}</span>
                        </div>
                        <div className="flex items-center gap-3 text-xs">
                          <span className="flex items-center gap-1 text-emerald-700">
                            <CheckCircle2 className="h-3.5 w-3.5" aria-hidden="true" />
                            {entry.strongCount}
                            <span className="sr-only">strong</span>
                          </span>
                          <span className="flex items-center gap-1 text-amber-700">
                            <AlertCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            {entry.partialCount}
                            <span className="sr-only">partial</span>
                          </span>
                          <span className="flex items-center gap-1 text-rose-700">
                            <XCircle className="h-3.5 w-3.5" aria-hidden="true" />
                            {entry.missingCount}
                            <span className="sr-only">missing</span>
                          </span>
                        </div>
                        <div className="flex items-center">
                          <Button variant="ghost" size="sm" aria-label={`Open analysis from ${new Date(entry.date).toLocaleString()}`} onClick={() => onOpenAnalysis(entry.id).catch((err) => setError(err.message))}>
                            <ExternalLink className="h-4 w-4" />
                          </Button>
                          <Button variant="ghost" size="sm" aria-label={`Delete analysis from ${new Date(entry.date).toLocaleString()}`} onClick={() => handleDelete(entry.id)}>
                            <Trash2 className="h-4 w-4 text-rose-500" />
                          </Button>
                        </div>
                      </div>
                    </li>
                  ))}
                </ol>
              </CardContent>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
