import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { AnalysisResult, Page, RoadmapItem } from "@/types";
import {
  CheckCircle2,
  AlertCircle,
  XCircle,
  ArrowRight,
  BookOpen,
  Target,
  Sparkles,
  RefreshCw,
} from "lucide-react";

interface RoadmapPageProps {
  analysisResult: AnalysisResult | null;
  onNavigate: (page: Page) => void;
}

export function RoadmapPage({ analysisResult, onNavigate }: RoadmapPageProps) {
  const getRoadmapItems = (): RoadmapItem[] => {
    if (!analysisResult) return [];

    const items: RoadmapItem[] = [];

    // Highest-impact work first: missing (required before preferred), then partial, then strong to maintain.
    const byRequirement = <T extends { requirementType: string }>(a: T, b: T) =>
      a.requirementType === b.requirementType ? 0 : a.requirementType === "required" ? -1 : 1;

    [...analysisResult.missingSkills].sort(byRequirement).forEach((skill) => {
      items.push({
        skill: skill.skill,
        status: "missing",
        action: `${skill.requirementType === "required" ? "Required" : "Preferred"} by the role. Learn the fundamentals first, then build a portfolio project that uses it.`,
        priority: skill.requirementType === "required" ? "high" : "medium",
        stage: items.length + 1,
      });
    });

    [...analysisResult.partialSkills].sort(byRequirement).forEach((skill) => {
      items.push({
        skill: skill.skill,
        status: "partial",
        action: `Currently only in your ${skill.section ?? "resume"} section. Strengthen the evidence with an experience or project bullet that shows it in use.`,
        priority: "medium",
        stage: items.length + 1,
      });
    });

    analysisResult.strongSkills.forEach((skill) => {
      items.push({
        skill: skill.skill,
        status: "strong",
        action: "Already demonstrated. Keep it current and quantify the impact of that work on your resume.",
        priority: "low",
        stage: items.length + 1,
      });
    });

    return items;
  };

  const items = getRoadmapItems();

  const getStatusIcon = (status: string) => {
    switch (status) {
      case "strong":
        return <CheckCircle2 className="w-5 h-5 text-emerald-500" />;
      case "partial":
        return <AlertCircle className="w-5 h-5 text-amber-500" />;
      case "missing":
        return <XCircle className="w-5 h-5 text-rose-500" />;
      default:
        return null;
    }
  };

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case "high":
        return "bg-rose-50 text-rose-700 border-rose-200";
      case "medium":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "low":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      default:
        return "";
    }
  };

  return (
    <div className="max-w-4xl mx-auto px-8 py-8">
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-slate-900">Career Roadmap</h1>
        <p className="text-slate-600 mt-1">
          Your personalized path to becoming job-ready for this role.
        </p>
      </div>

      {!analysisResult ? (
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardContent className="p-12 text-center">
            <Target className="w-12 h-12 text-slate-300 mx-auto mb-4" />
            <h3 className="text-lg font-semibold text-slate-900 mb-2">No Analysis Yet</h3>
            <p className="text-slate-600 mb-6">
              Run an analysis first to get your personalized career roadmap.
            </p>
            <Button className="bg-slate-900 hover:bg-slate-800 text-white" onClick={() => onNavigate("analysis")}>
              Start New Analysis
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {items.map((item, index) => (
            <div key={item.skill} className="relative">
              {index < items.length - 1 && (
                <div className="absolute left-8 top-16 bottom-0 w-px bg-slate-200" />
              )}
              <Card className="bg-white border-slate-200 shadow-sm">
                <CardContent className="p-6">
                  <div className="flex items-start gap-4">
                    <div className="w-16 h-16 bg-slate-900 rounded-xl flex items-center justify-center shrink-0">
                      <span className="text-2xl font-bold text-cyan-400">{item.stage}</span>
                    </div>
                    <div className="flex-1">
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                          {getStatusIcon(item.status)}
                          <h3 className="font-semibold text-slate-900">{item.skill}</h3>
                        </div>
                        <Badge className={getPriorityColor(item.priority)}>
                          {item.priority} priority
                        </Badge>
                      </div>
                      <p className="text-sm text-slate-600 mb-3">{item.action}</p>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="text-xs">
                          {item.status}
                        </Badge>
                        {item.resource && (
                          <Badge variant="outline" className="text-xs">
                            <BookOpen className="w-3 h-3 mr-1" />
                            {item.resource}
                          </Badge>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}

          <Card className="bg-gradient-to-br from-cyan-500 to-cyan-600 text-white border-0">
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <Sparkles className="w-8 h-8 shrink-0" />
                <div className="flex-1">
                  <h3 className="font-semibold mb-1">Next Steps</h3>
                  <p className="text-sm text-cyan-50">
                    After completing these steps, re-analyze your resume to track your progress and see your score improve.
                  </p>
                </div>
                <Button className="bg-white text-cyan-600 hover:bg-cyan-50" onClick={() => onNavigate("analysis")}>
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Re-analyze
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}