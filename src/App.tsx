import { useEffect, useState } from "react";
import { Sidebar } from "@/components/Sidebar";
import { HomePage } from "@/components/HomePage";
import { AnalysisPage } from "@/components/AnalysisPage";
import { ResultsPage } from "@/components/ResultsPage";
import { AssistantPage } from "@/components/AssistantPage";
import { RoadmapPage } from "@/components/RoadmapPage";
import { ProgressPage } from "@/components/ProgressPage";
import { SettingsPage } from "@/components/SettingsPage";
import { AuthPage } from "@/components/AuthPage";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { AnalysisResult, Page } from "@/types";
import { Loader2, Target } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const { user, loading, login, signup, logout, setUser, clearUser } = useAuth();

  // Load the most recent saved analysis after login so results survive a page refresh.
  useEffect(() => {
    if (!user) {
      setAnalysisResult(null);
      setCurrentPage("home");
      return;
    }
    api
      .latestAnalysis()
      .then(({ result }) => setAnalysisResult(result))
      .catch(() => undefined);
  }, [user?.email]); // eslint-disable-line react-hooks/exhaustive-deps

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  if (!user) {
    return <AuthPage onLogin={login} onSignup={signup} />;
  }

  const handleAnalysisComplete = (result: AnalysisResult) => {
    setAnalysisResult(result);
    setCurrentPage("results");
  };

  const handleNavigate = (page: Page) => {
    setCurrentPage(page);
  };

  const handleOpenAnalysis = async (id: string) => {
    const { result } = await api.getAnalysis(id);
    setAnalysisResult(result);
    setCurrentPage("results");
  };

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar currentPage={currentPage} onNavigate={handleNavigate} user={user} onLogout={logout} />
      <main className="flex-1 overflow-y-auto">
        {currentPage === "home" && (
          <HomePage onNavigate={handleNavigate} hasAnalysis={!!analysisResult} />
        )}
        {currentPage === "analysis" && (
          <AnalysisPage onAnalysisComplete={handleAnalysisComplete} />
        )}
        {currentPage === "results" &&
          (analysisResult ? (
            <ResultsPage result={analysisResult} onNavigate={handleNavigate} />
          ) : (
            <div className="max-w-4xl mx-auto px-8 py-8">
              <Card className="bg-white border-slate-200 shadow-sm">
                <CardContent className="p-12 text-center">
                  <Target className="w-12 h-12 text-slate-300 mx-auto mb-4" />
                  <h3 className="text-lg font-semibold text-slate-900 mb-2">No Results Yet</h3>
                  <p className="text-slate-600 mb-6">Run an analysis to see your match score and skill gaps.</p>
                  <Button className="bg-slate-900 hover:bg-slate-800 text-white" onClick={() => handleNavigate("analysis")}>
                    Start New Analysis
                  </Button>
                </CardContent>
              </Card>
            </div>
          ))}
        {currentPage === "assistant" && (
          <AssistantPage analysisResult={analysisResult} />
        )}
        {currentPage === "roadmap" && (
          <RoadmapPage analysisResult={analysisResult} onNavigate={handleNavigate} />
        )}
        {currentPage === "progress" && (
          <ProgressPage
            onOpenAnalysis={handleOpenAnalysis}
            onDeleted={(id) => {
              if (analysisResult?.id === id) setAnalysisResult(null);
            }}
          />
        )}
        {currentPage === "settings" && (
          <SettingsPage user={user} onLogout={logout} onUserUpdated={setUser} onAccountDeleted={clearUser} />
        )}
      </main>
    </div>
  );
}
