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
import { PreviewBanner } from "@/components/PreviewBanner";
import { useAuth } from "@/hooks/useAuth";
import { api } from "@/lib/api";
import { AnalysisResult, Page } from "@/types";
import { CheckCircle2, Loader2, Target, X, AlertCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Pages that need an account. Guests can use Home, one New Analysis, Results and the Roadmap. */
const LOCKED_PAGES: ReadonlySet<Page> = new Set<Page>(["assistant", "progress", "settings"]);

const LOCKED_NOTICE: Partial<Record<Page, string>> = {
  assistant: "Log in to chat with the Career Assistant about your results.",
  progress: "Log in to save your analyses and track progress over time.",
  settings: "Log in to manage your account settings.",
};

export default function App() {
  const [currentPage, setCurrentPage] = useState<Page>("home");
  const [analysisResult, setAnalysisResult] = useState<AnalysisResult | null>(null);
  const [auth, setAuth] = useState<{ open: boolean; notice: string | null; mode: "login" | "signup" }>({
    open: false,
    notice: null,
    mode: "login",
  });
  const {
    user,
    loading,
    providers,
    verifyOutcome,
    dismissVerifyOutcome,
    login,
    signup,
    loginWithGoogle,
    logout,
    setUser,
    clearUser,
  } = useAuth();

  // Load the latest saved analysis (the account's, or this browser's free guest analysis) so results survive a refresh.
  useEffect(() => {
    if (loading) return;
    api
      .latestAnalysis()
      .then(({ result }) => setAnalysisResult(result))
      .catch(() => setAnalysisResult(null));
    if (user) setAuth((a) => ({ ...a, open: false, notice: null }));
  }, [user?.email, loading]); // eslint-disable-line react-hooks/exhaustive-deps

  // An invalid/expired verification link should land on the auth screen with the explanation.
  useEffect(() => {
    if (verifyOutcome && !verifyOutcome.ok) setAuth({ open: true, notice: verifyOutcome.message, mode: "login" });
  }, [verifyOutcome]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-slate-900">
        <Loader2 className="w-8 h-8 text-cyan-400 animate-spin" />
      </div>
    );
  }

  const openAuth = (notice: string | null = null, mode: "login" | "signup" = "login") => setAuth({ open: true, notice, mode });

  if (!user && auth.open) {
    return (
      <>
        <PreviewBanner className="fixed top-0 inset-x-0 z-50" />
        <AuthPage
          key={auth.notice ?? "auth"}
          providers={providers}
          onLogin={login}
          onSignup={signup}
          onGoogle={loginWithGoogle}
          notice={auth.notice}
          initialMode={auth.mode}
          onBack={() => {
            setAuth({ open: false, notice: null, mode: "login" });
            dismissVerifyOutcome();
          }}
        />
      </>
    );
  }

  const handleAnalysisComplete = (result: AnalysisResult) => {
    setAnalysisResult(result);
    setCurrentPage("results");
  };

  const handleNavigate = (page: Page) => {
    if (!user && LOCKED_PAGES.has(page)) {
      openAuth(LOCKED_NOTICE[page] ?? null);
      return;
    }
    setCurrentPage(page);
  };

  const handleLogout = async () => {
    await logout();
    setCurrentPage("home");
  };

  const handleOpenAnalysis = async (id: string) => {
    const { result } = await api.getAnalysis(id);
    setAnalysisResult(result);
    setCurrentPage("results");
  };

  return (
    <div className="flex h-screen bg-slate-50">
      <Sidebar
        currentPage={currentPage}
        onNavigate={handleNavigate}
        user={user}
        onLogout={handleLogout}
        onSignIn={() => openAuth()}
        lockedPages={LOCKED_PAGES}
      />
      <main className="flex-1 overflow-y-auto">
        <PreviewBanner className="sticky top-0 z-40" />
        {verifyOutcome?.ok && (
          <div role="status" className="flex items-center gap-2 bg-emerald-50 text-emerald-800 text-sm px-6 py-3 border-b border-emerald-200">
            <CheckCircle2 className="w-4 h-4" />
            <span className="flex-1">{verifyOutcome.message}</span>
            <button type="button" aria-label="Dismiss" onClick={dismissVerifyOutcome}>
              <X className="w-4 h-4" />
            </button>
          </div>
        )}
        {user && !user.emailVerified && (
          <div role="note" className="flex items-center gap-2 bg-amber-50 text-amber-900 text-sm px-6 py-3 border-b border-amber-200">
            <AlertCircle className="w-4 h-4" />
            Verify your new email address using the link we sent - you'll need it the next time you log in.
          </div>
        )}
        {currentPage === "home" && (
          <HomePage onNavigate={handleNavigate} hasAnalysis={!!analysisResult} isGuest={!user} />
        )}
        {currentPage === "analysis" && (
          <AnalysisPage
            onAnalysisComplete={handleAnalysisComplete}
            isGuest={!user}
            onLoginRequired={(message) => openAuth(message, "signup")}
          />
        )}
        {currentPage === "results" &&
          (analysisResult ? (
            <ResultsPage result={analysisResult} onNavigate={handleNavigate} isGuest={!user} onSignIn={() => openAuth(null, "signup")} />
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
        {currentPage === "assistant" && user && (
          <AssistantPage analysisResult={analysisResult} />
        )}
        {currentPage === "roadmap" && (
          <RoadmapPage analysisResult={analysisResult} onNavigate={handleNavigate} />
        )}
        {currentPage === "progress" && user && (
          <ProgressPage
            onOpenAnalysis={handleOpenAnalysis}
            onDeleted={(id) => {
              if (analysisResult?.id === id) setAnalysisResult(null);
            }}
          />
        )}
        {currentPage === "settings" && user && (
          <SettingsPage
            user={user}
            onLogout={handleLogout}
            onUserUpdated={setUser}
            onAccountDeleted={() => {
              clearUser();
              setCurrentPage("home");
            }}
          />
        )}
      </main>
    </div>
  );
}
