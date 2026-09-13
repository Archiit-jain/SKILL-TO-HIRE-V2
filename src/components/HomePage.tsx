import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Page } from "@/types";
import {
  Upload,
  Search,
  Brain,
  TrendingUp,
  ArrowRight,
  FileText,
  Target,
  Sparkles,
  ShieldCheck,
} from "lucide-react";

interface HomePageProps {
  onNavigate: (page: Page) => void;
  hasAnalysis: boolean;
  isGuest: boolean;
}

export function HomePage({ onNavigate, hasAnalysis, isGuest }: HomePageProps) {
  return (
    <div className="min-h-full">
      {/* Hero Section */}
      <div className="bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 text-white">
        <div className="max-w-5xl mx-auto px-8 py-16">
          <div className="inline-flex items-center gap-2 bg-cyan-500/10 text-cyan-400 px-4 py-1.5 rounded-full text-sm mb-6">
            <Sparkles className="w-4 h-4" />
            AI-Powered Career Intelligence
          </div>
          <h1 className="text-4xl font-bold mb-4">
            Know Your Skills.
            <br />
            Bridge Your Gaps.
            <span className="text-cyan-400"> Get Hired.</span>
          </h1>
          <p className="text-lg text-slate-300 max-w-2xl mb-8">
            Analyze your resume against a job description, understand exactly where you stand,
            and get evidence-backed guidance to improve.
          </p>
          <div className="flex gap-4">
            <Button
              size="lg"
              className="bg-cyan-500 hover:bg-cyan-400 text-slate-900"
              onClick={() => onNavigate("analysis")}
            >
              {isGuest && !hasAnalysis ? "Try a Free Analysis" : "Start New Analysis"}
              <ArrowRight className="w-4 h-4 ml-2" />
            </Button>
            {hasAnalysis && (
              <Button
                size="lg"
                variant="outline"
                className="border-slate-600 text-white hover:bg-slate-800"
                onClick={() => onNavigate("results")}
              >
                View Latest Results
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Process Flow */}
      <div className="max-w-5xl mx-auto px-8 py-12">
        <h2 className="text-2xl font-bold text-slate-900 mb-8">How It Works</h2>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-6">
          {[
            { icon: Upload, title: "Upload", desc: "Add your resume and target job description" },
            { icon: Search, title: "Analyze", desc: "Our engine extracts skills and requirements" },
            { icon: Brain, title: "Understand", desc: "See evidence-backed match scores and gaps" },
            { icon: TrendingUp, title: "Improve", desc: "Get a personalized roadmap to get hired" },
          ].map((step, i) => {
            const Icon = step.icon;
            return (
              <Card key={i} className="bg-white border-slate-200 shadow-sm">
                <CardContent className="p-6">
                  <div className="w-12 h-12 bg-slate-900 rounded-xl flex items-center justify-center mb-4">
                    <Icon className="w-6 h-6 text-cyan-400" />
                  </div>
                  <h3 className="font-semibold text-slate-900 mb-2">{step.title}</h3>
                  <p className="text-sm text-slate-600">{step.desc}</p>
                </CardContent>
              </Card>
            );
          })}
        </div>
      </div>

      {/* Features */}
      <div className="bg-white border-t border-slate-200">
        <div className="max-w-5xl mx-auto px-8 py-12">
          <h2 className="text-2xl font-bold text-slate-900 mb-8">Why Skill2Hire?</h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-6">
                <Target className="w-8 h-8 text-cyan-600 mb-4" />
                <h3 className="font-semibold text-slate-900 mb-2">Evidence-Backed</h3>
                <p className="text-sm text-slate-600">
                  Every score comes with actual resume evidence. No black-box AI decisions.
                </p>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-6">
                <FileText className="w-8 h-8 text-cyan-600 mb-4" />
                <h3 className="font-semibold text-slate-900 mb-2">Honest Gaps</h3>
                <p className="text-sm text-slate-600">
                  See exactly what's strong, partial, or missing - with clear explanations.
                </p>
              </CardContent>
            </Card>
            <Card className="bg-slate-50 border-slate-200">
              <CardContent className="p-6">
                <ShieldCheck className="w-8 h-8 text-cyan-600 mb-4" />
                <h3 className="font-semibold text-slate-900 mb-2">Privacy First</h3>
                <p className="text-sm text-slate-600">
                  Uploaded files are processed in memory and discarded. Only your results are saved, and you can delete them.
                </p>
              </CardContent>
            </Card>
          </div>
        </div>
      </div>
    </div>
  );
}