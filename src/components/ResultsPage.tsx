import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { AnalysisResult, Page } from "@/types";
import {
  CheckCircle2,
  XCircle,
  AlertCircle,
  ArrowRight,
  Target,
  FileText,
  Briefcase,
  GraduationCap,
  FolderGit2,
  BadgeCheck,
  Sparkles,
  MessageSquare,
  BookOpen,
} from "lucide-react";

function EmptyNote() {
  return <p className="text-sm text-slate-400">None</p>;
}

interface ResultsPageProps {
  result: AnalysisResult;
  onNavigate: (page: Page) => void;
  isGuest: boolean;
  onSignIn: () => void;
}

export function ResultsPage({ result, onNavigate, isGuest, onSignIn }: ResultsPageProps) {
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

  const getStatusColor = (status: string) => {
    switch (status) {
      case "strong":
        return "bg-emerald-50 text-emerald-700 border-emerald-200";
      case "partial":
        return "bg-amber-50 text-amber-700 border-amber-200";
      case "missing":
        return "bg-rose-50 text-rose-700 border-rose-200";
      default:
        return "";
    }
  };

  return (
    <div className="max-w-6xl mx-auto px-8 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-slate-900">Analysis Results</h1>
          <p className="text-slate-600 mt-1">
            {result.resumeName} vs {result.jdTitle}
          </p>
        </div>
        <Badge variant="outline" className="text-slate-500">
          {new Date(result.analyzedAt).toLocaleDateString()}
        </Badge>
      </div>

      {/* Overall Score */}
      <Card className="mb-8 bg-gradient-to-br from-slate-900 to-slate-800 text-white border-0">
        <CardContent className="p-8">
          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm text-slate-300 mb-2">YOUR COMPATIBILITY</p>
              <div className="flex items-end gap-2">
                <span className="text-6xl font-bold">{result.overallScore.toFixed(1)}</span>
                <span className="text-2xl text-slate-400 mb-2">/ 100</span>
              </div>
              <p className="text-slate-300 mt-4 max-w-md">
                Here's why you received this score, with evidence from your resume and the job description.
              </p>
            </div>
            <div className="w-32 h-32 rounded-full border-8 border-cyan-500 flex items-center justify-center">
              <div className="text-center">
                <div className="text-3xl font-bold">{result.overallScore.toFixed(0)}%</div>
                <div className="text-xs text-slate-300">Match</div>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Score Components */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-8">
        {result.components.map((component) => (
          <Card key={component.name} className="bg-white border-slate-200 shadow-sm">
            <CardContent className="p-6">
              <div className="flex items-center justify-between mb-2">
                <h3 className="font-semibold text-slate-900">{component.name}</h3>
                <span className="text-2xl font-bold text-slate-900">{component.score.toFixed(0)}</span>
              </div>
              <Progress value={component.score} className="mb-3" />
              <p className="text-sm text-slate-600">{component.description}</p>
              <p className="text-xs text-slate-400 mt-2">Weight: {(component.weight * 100).toFixed(0)}%</p>
            </CardContent>
          </Card>
        ))}
      </div>
      {result.notAssessed.length > 0 && (
        <div className="mb-8 -mt-4 p-4 bg-slate-100 rounded-lg text-sm text-slate-600">
          <p className="font-medium text-slate-700 mb-1">Not scored (weights redistributed):</p>
          <ul className="list-disc pl-5 space-y-0.5">
            {result.notAssessed.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Skill Gaps */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-8">
        {/* Strong Skills */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="w-5 h-5" />
              Strong ({result.strongSkills.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.strongSkills.length === 0 && <EmptyNote />}
            {result.strongSkills.map((skill) => (
              <div key={skill.skill} className="p-3 bg-emerald-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-slate-900">{skill.skill}</span>
                  <Badge className="bg-emerald-100 text-emerald-700 border-emerald-200" title="Wording overlap between this evidence and what the job description says about the skill">
                    {skill.similarityScore}% context
                  </Badge>
                </div>
                {skill.evidence && (
                  <p className="text-sm text-slate-600 line-clamp-2">{skill.evidence}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">Section: {skill.section}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Partial Skills */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-amber-700">
              <AlertCircle className="w-5 h-5" />
              Partial ({result.partialSkills.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.partialSkills.length === 0 && <EmptyNote />}
            {result.partialSkills.map((skill) => (
              <div key={skill.skill} className="p-3 bg-amber-50 rounded-lg">
                <div className="flex items-center justify-between mb-2">
                  <span className="font-medium text-slate-900">{skill.skill}</span>
                  <Badge className="bg-amber-100 text-amber-700 border-amber-200" title="Wording overlap between this evidence and what the job description says about the skill">
                    {skill.similarityScore}% context
                  </Badge>
                </div>
                {skill.evidence && (
                  <p className="text-sm text-slate-600 line-clamp-2">{skill.evidence}</p>
                )}
                <p className="text-xs text-slate-400 mt-1">Section: {skill.section}</p>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Missing Skills */}
        <Card className="bg-white border-slate-200 shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-rose-700">
              <XCircle className="w-5 h-5" />
              Missing ({result.missingSkills.length})
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {result.missingSkills.length === 0 && <EmptyNote />}
            {result.missingSkills.map((skill) => (
              <div key={skill.skill} className="p-3 bg-rose-50 rounded-lg">
                <div className="flex items-center justify-between">
                  <span className="font-medium text-slate-900">{skill.skill}</span>
                  <Badge className="bg-rose-100 text-rose-700 border-rose-200">
                    {skill.requirementType}
                  </Badge>
                </div>
                <p className="text-sm text-slate-600 mt-2">
                  {skill.requirementType === "required" ? "Required" : "Preferred"} by target role - not found in your resume
                </p>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Why Not Me */}
      <Card className="mb-8 bg-white border-slate-200 shadow-sm">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Target className="w-5 h-5 text-cyan-600" />
            Why Not Me?
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            <div>
              <h4 className="font-semibold text-emerald-700 mb-3">What You Already Have</h4>
              <ul className="space-y-2">
                {result.whyNotMe.strengths.length === 0 && <li className="text-sm text-slate-400">Nothing here</li>}
                {result.whyNotMe.strengths.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <CheckCircle2 className="w-4 h-4 text-emerald-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-rose-700 mb-3">What Is Missing</h4>
              <ul className="space-y-2">
                {result.whyNotMe.gaps.length === 0 && <li className="text-sm text-slate-400">Nothing here</li>}
                {result.whyNotMe.gaps.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <XCircle className="w-4 h-4 text-rose-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-amber-700 mb-3">What Is Weakly Supported</h4>
              <ul className="space-y-2">
                {result.whyNotMe.weakSupport.length === 0 && <li className="text-sm text-slate-400">Nothing here</li>}
                {result.whyNotMe.weakSupport.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <AlertCircle className="w-4 h-4 text-amber-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="font-semibold text-cyan-700 mb-3">What Would Improve Your Match</h4>
              <ul className="space-y-2">
                {result.whyNotMe.improvements.length === 0 && <li className="text-sm text-slate-400">Nothing here</li>}
                {result.whyNotMe.improvements.map((item, i) => (
                  <li key={i} className="flex items-start gap-2 text-sm text-slate-600">
                    <Sparkles className="w-4 h-4 text-cyan-500 mt-0.5 shrink-0" />
                    {item}
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {isGuest && (
        <Card className="mb-6 bg-cyan-50 border-cyan-200">
          <CardContent className="p-6 flex flex-col md:flex-row md:items-center gap-4">
            <div className="flex-1">
              <h3 className="font-semibold text-slate-900">Save this result and keep going</h3>
              <p className="text-sm text-slate-600">
                This was your free analysis. Create an account (or continue with Google) to keep it in your history,
                chat with the Career Assistant and run more analyses.
              </p>
            </div>
            <Button className="bg-slate-900 hover:bg-slate-800 text-white" onClick={onSignIn}>
              Create free account
            </Button>
          </CardContent>
        </Card>
      )}

      {/* Next Steps */}
      <div className="flex gap-4">
        <Button
          className="bg-slate-900 hover:bg-slate-800 text-white"
          onClick={() => onNavigate("assistant")}
        >
          <MessageSquare className="w-4 h-4 mr-2" />
          Ask Career Assistant
        </Button>
        <Button
          variant="outline"
          className="border-slate-300 text-slate-700 hover:bg-slate-50"
          onClick={() => onNavigate("roadmap")}
        >
          <BookOpen className="w-4 h-4 mr-2" />
          View Career Roadmap
        </Button>
      </div>
    </div>
  );
}