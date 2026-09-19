import { useEffect, useState } from "react";
import { Logo, Sidebar } from "@/components/Sidebar";
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
import type { AnalysisResult, Page } from "@/types";
import { AlertCircle, CheckCircle2, FlaskConical, Loader2, Menu, Target, X } from "lucide-react";
import { ThemeToggle } from "@/components/ThemeToggle";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";

/** Pages that need an account. Guests can use Home, one New Analysis, Results and the Roadmap. */
const LOCKED_PAGES: ReadonlySet<Page> = new Set<Page>(["assistant", "progress", "settings"]);

const SIDEBAR_KEY = "s2h-sidebar-collapsed";

/** The sidebar starts collapsed on narrow screens; an explicit choice is remembered. */
function readCollapsed(): boolean {
  try {
    const saved = localStorage.getItem(SIDEBAR_KEY);
    if (saved === "true" || saved === "false") return saved === "true";
  } catch {
    /* storage blocked: fall back to the width */
  }
  return typeof window !== "undefined" && window.innerWidth < 1024;
}

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
  const [menuOpen, setMenuOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [demoError, setDemoError] = useState<string | null>(null);
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

  // The mobile menu closes with Escape.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setMenuOpen(false);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  const toggleCollapsed = () =>
    setCollapsed((previous) => {
      const next = !previous;
      try {
        localStorage.setItem(SIDEBAR_KEY, String(next));
      } catch {
        /* choice just won't be remembered */
      }
      return next;
    });

  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ink-950" aria-label="Loading">
        <Loader2 className="h-8 w-8 animate-spin text-parrot-400" aria-hidden="true" />
      </div>
    );
  }

  const openAuth = (notice: string | null = null, mode: "login" | "signup" = "login") => setAuth({ open: true, notice, mode });

  if (!user && auth.open) {
    return (
      <>
        <PreviewBanner persistentStorage={providers.persistentStorage} className="fixed inset-x-0 top-0 z-50" />
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

  const showResult = (result: AnalysisResult) => {
    setAnalysisResult(result);
    setCurrentPage("results");
  };

  const handleTryDemo = async () => {
    setDemoError(null);
    try {
      const { result } = await api.demoAnalysis();
      showResult(result);
    } catch (err) {
      setDemoError(err instanceof Error ? err.message : "The sample analysis couldn't be loaded.");
    }
  };

  const handleNavigate = (page: Page) => {
    setMenuOpen(false);
    // The sample analysis has its own rules-only assistant, which guests may use.
    const demoAssistant = page === "assistant" && !!analysisResult?.demo;
    if (!user && LOCKED_PAGES.has(page) && !demoAssistant) {
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
    showResult(result);
  };

  const sidebarProps = {
    currentPage,
    onNavigate: handleNavigate,
    user,
    onLogout: handleLogout,
    onSignIn: () => {
      setMenuOpen(false);
      openAuth();
    },
  };

  return (
    <div className="flex h-screen flex-col bg-slate-50 md:flex-row">
      {/* Mobile top bar */}
      <header className="flex h-14 shrink-0 items-center justify-between bg-ink-900 px-4 text-ink-50 md:hidden">
        <Logo onClick={() => handleNavigate("home")} />
        <div className="flex items-center gap-1">
          <ThemeToggle tone="ink" />
          <Button
            variant="ghost"
            size="icon"
            className="text-ink-200 hover:bg-ink-800 hover:text-ink-50"
            aria-label="Open menu"
            aria-expanded={menuOpen}
            aria-controls="mobile-menu"
            onClick={() => setMenuOpen(true)}
          >
            <Menu className="h-5 w-5" />
          </Button>
        </div>
      </header>

      {/* Mobile drawer */}
      {menuOpen && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <button type="button" className="absolute inset-0 h-full w-full bg-ink-950/70" aria-label="Close menu" tabIndex={-1} onClick={() => setMenuOpen(false)} />
          <div id="mobile-menu" className="absolute inset-y-0 left-0 shadow-2xl">
            <Sidebar {...sidebarProps} variant="drawer" onClose={() => setMenuOpen(false)} />
          </div>
        </div>
      )}

      {/* Sidebar (collapsible at every width from tablet up; phones use the drawer above) */}
      <div className="hidden md:flex">
        <Sidebar {...sidebarProps} collapsed={collapsed} onToggleCollapsed={toggleCollapsed} />
      </div>

      <main className="min-h-0 flex-1 overflow-y-auto">
        <PreviewBanner persistentStorage={providers.persistentStorage} className="sticky top-0 z-40" />
        {verifyOutcome?.ok && (
          <div role="status" className="flex items-center gap-2 border-b border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800 sm:px-6">
            <CheckCircle2 className="h-4 w-4" aria-hidden="true" />
            <span className="flex-1">{verifyOutcome.message}</span>
            <button type="button" aria-label="Dismiss" onClick={dismissVerifyOutcome}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {user && !user.emailVerified && (
          <div role="note" className="flex items-center gap-2 border-b border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900 sm:px-6">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            Verify your new email address using the link we sent - you'll need it the next time you log in.
          </div>
        )}
        {demoError && (
          <div role="alert" className="flex items-center gap-2 border-b border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700 sm:px-6">
            <AlertCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
            <span className="flex-1">{demoError}</span>
            <button type="button" aria-label="Dismiss" onClick={() => setDemoError(null)}>
              <X className="h-4 w-4" />
            </button>
          </div>
        )}
        {currentPage === "home" && (
          <HomePage onNavigate={handleNavigate} onOpenDemo={showResult} hasAnalysis={!!analysisResult && !analysisResult.demo} isGuest={!user} />
        )}
        {currentPage === "analysis" && (
          <AnalysisPage
            onAnalysisComplete={showResult}
            isGuest={!user}
            onLoginRequired={(message) => openAuth(message, "signup")}
            onTryDemo={handleTryDemo}
          />
        )}
        {currentPage === "results" &&
          (analysisResult ? (
            <ResultsPage result={analysisResult} onNavigate={handleNavigate} isGuest={!user} onSignIn={() => openAuth(null, "signup")} />
          ) : (
            <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 lg:px-8 lg:py-8">
              <Card className="border-slate-200 bg-white shadow-sm">
                <CardContent className="p-8 text-center sm:p-12">
                  <Target className="mx-auto mb-4 h-12 w-12 text-slate-300" aria-hidden="true" />
                  <h1 className="mb-2 text-lg font-semibold text-slate-900">No results yet</h1>
                  <p className="mb-6 text-slate-600">Run an analysis to see your match score and skill gaps, or look at the sample first.</p>
                  <div className="flex flex-col justify-center gap-3 sm:flex-row">
                    <Button className="bg-slate-900 text-white hover:bg-slate-800" onClick={() => handleNavigate("analysis")}>
                      Start New Analysis
                    </Button>
                    <Button variant="outline" onClick={handleTryDemo}>
                      <FlaskConical className="mr-2 h-4 w-4" aria-hidden="true" />
                      Try Demo Analysis
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </div>
          ))}
        {currentPage === "assistant" && (user || analysisResult?.demo) && <AssistantPage key={analysisResult?.id ?? "none"} analysisResult={analysisResult} />}
        {currentPage === "roadmap" && <RoadmapPage analysisResult={analysisResult} onNavigate={handleNavigate} />}
        {currentPage === "progress" && user && (
          <ProgressPage
            onOpenAnalysis={handleOpenAnalysis}
            onNavigate={handleNavigate}
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
