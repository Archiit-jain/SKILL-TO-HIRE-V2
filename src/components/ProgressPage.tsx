import { useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { api } from "@/lib/api";
import { ProgressEntry } from "@/types";
import {
  TrendingUp,
  History,
  CheckCircle2,
  AlertCircle,
  XCircle,
  Calendar,
  Loader2,
  Trash2,
  ExternalLink,
} from "lucide-react";

interface ProgressPageProps {
  onOpenAnalysis: (id: string) => Promise<void>;
  onDeleted: (id: string) => void;
}

export function ProgressPage({ onOpenAnalysis, onDeleted }: ProgressPageProps) {
  const [history, setHistory] = useState<ProgressEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .history()
      .then(({ analyses }) => setHistory(analyses))
      .catch((err) => setError(err instanceof Error ? err.message : "Could not load history"));
  }, []);

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

  // Oldest first for the trend timeline; newest first for the history list.
  const timeline = history ? [...history].reverse() : [];

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Your Progress</h1>
        <p className="text-slate-600 mt-1">
          Track your improvement across analyses over time.
        </p>
      </div>

      {error && (
        <div role="alert" className="p-4 mb-6 rounded-lg bg-rose-50 text-rose-700 text-sm border border-rose-200">
          {error}
        </div>
      )}

      {history === null && !error && (
        <div className="flex justify-center py-16">
          <Loader2 className="w-6 h-6 text-slate-400 animate-spin" />
        </div>
      )}

      {history?.length === 0 && (
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-12 text-center text-slate-600">
            No analyses yet. Your score history appears here after your first analysis.
          </CardContent>
        </Card>
      )}

      {history && history.length > 0 && (
        <>
          {/* Score Trend */}
          <Card className="mb-8 bg-white border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-cyan-600" />
                Score History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-6">
                {timeline.map((entry, i) => (
                  <div key={entry.id} className="relative">
                    {i < timeline.length - 1 && (
                      <div className="absolute left-4 top-10 bottom-0 w-px bg-slate-200" />
                    )}
                    <div className="flex items-start gap-4">
                      <div className="w-8 h-8 bg-slate-900 rounded-full flex items-center justify-center shrink-0">
                        <Calendar className="w-4 h-4 text-cyan-400" />
                      </div>
                      <div className="flex-1">
                        <div className="flex items-center justify-between mb-2">
                          <div>
                            <p className="font-semibold text-slate-900">{entry.jdTitle}</p>
                            <p className="text-sm text-slate-500">
                              {new Date(entry.date).toLocaleDateString()}
                            </p>
                          </div>
                          <div className="text-right">
                            <span className="text-2xl font-bold text-slate-900">
                              {entry.score.toFixed(1)}
                            </span>
                            <span className="text-sm text-slate-400"> / 100</span>
                          </div>
                        </div>
                        <Progress value={entry.score} className="mb-3" />
                        <div className="flex gap-4 text-sm">
                          <span className="flex items-center gap-1 text-emerald-600">
                            <CheckCircle2 className="w-4 h-4" />
                            {entry.strongCount} Strong
                          </span>
                          <span className="flex items-center gap-1 text-amber-600">
                            <AlertCircle className="w-4 h-4" />
                            {entry.partialCount} Partial
                          </span>
                          <span className="flex items-center gap-1 text-rose-600">
                            <XCircle className="w-4 h-4" />
                            {entry.missingCount} Missing
                          </span>
                        </div>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Analysis History */}
          <Card className="bg-white border-slate-200 shadow-sm">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <History className="w-5 h-5 text-cyan-600" />
                Analysis History
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {history.map((entry) => (
                  <div
                    key={entry.id}
                    className="flex items-center justify-between p-4 bg-slate-50 rounded-lg"
                  >
                    <div className="min-w-0">
                      <p className="font-medium text-slate-900 truncate">{entry.jdTitle}</p>
                      <p className="text-sm text-slate-500 truncate">
                        {entry.resumeName} · {new Date(entry.date).toLocaleString()}
                      </p>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <Badge variant="secondary" className="text-slate-600">
                        Score: {entry.score.toFixed(1)}
                      </Badge>
                      <Button variant="ghost" size="sm" aria-label="Open analysis" onClick={() => onOpenAnalysis(entry.id).catch((err) => setError(err.message))}>
                        <ExternalLink className="w-4 h-4" />
                      </Button>
                      <Button variant="ghost" size="sm" aria-label="Delete analysis" onClick={() => handleDelete(entry.id)}>
                        <Trash2 className="w-4 h-4 text-rose-500" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}
