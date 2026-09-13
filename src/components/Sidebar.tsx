import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { Page, User } from "@/types";
import {
  Home,
  FileText,
  Target,
  MessageSquare,
  BookOpen,
  TrendingUp,
  Settings,
  LogOut,
  LogIn,
  Lock,
  Shield,
  Sparkles,
} from "lucide-react";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  /** null = guest (not signed in). */
  user: User | null;
  onLogout: () => void;
  onSignIn: () => void;
  /** Pages that need an account; shown with a lock for guests. */
  lockedPages: ReadonlySet<Page>;
}

const navItems = [
  { page: "home" as Page, label: "Home", icon: Home },
  { page: "analysis" as Page, label: "New Analysis", icon: FileText },
  { page: "results" as Page, label: "Results", icon: Target },
  { page: "assistant" as Page, label: "Career Assistant", icon: MessageSquare },
  { page: "roadmap" as Page, label: "Career Roadmap", icon: BookOpen },
  { page: "progress" as Page, label: "Progress", icon: TrendingUp },
  { page: "settings" as Page, label: "Settings", icon: Settings },
];

export function Sidebar({ currentPage, onNavigate, user, onLogout, onSignIn, lockedPages }: SidebarProps) {
  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col shrink-0">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 bg-cyan-500 rounded-lg flex items-center justify-center">
            <Sparkles className="w-4 h-4" />
          </div>
          <div>
            <h1 className="font-bold text-lg leading-tight">Skill2Hire</h1>
            <p className="text-xs text-slate-400">Career Intelligence</p>
          </div>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        {navItems.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.page;
          const locked = !user && lockedPages.has(item.page);
          return (
            <Button
              key={item.page}
              variant="ghost"
              className={cn(
                "w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800",
                isActive && "bg-slate-800 text-white",
                locked && "text-slate-500"
              )}
              onClick={() => onNavigate(item.page)}
              title={locked ? "Log in to use this" : undefined}
            >
              <Icon className="w-4 h-4 mr-3" />
              {item.label}
              {locked && <Lock className="w-3 h-3 ml-auto" aria-label="Requires login" />}
            </Button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-3">
        {user ? (
          <>
            <div className="flex items-center gap-3">
              <div className="w-8 h-8 bg-slate-700 rounded-full flex items-center justify-center text-sm font-semibold">
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium truncate">{user.name}</p>
                <p className="text-xs text-slate-400 truncate">{user.email}</p>
              </div>
            </div>
            <div className="flex items-center gap-2 text-xs text-slate-400">
              <Shield className="w-3 h-3" />
              <span>Privacy Protected</span>
            </div>
            <Button
              variant="ghost"
              className="w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800"
              onClick={onLogout}
            >
              <LogOut className="w-4 h-4 mr-3" />
              Logout
            </Button>
          </>
        ) : (
          <>
            <p className="text-xs text-slate-400">
              You're using Skill2Hire as a guest. Log in to save results and run more analyses.
            </p>
            <Button className="w-full bg-cyan-500 hover:bg-cyan-400 text-slate-900" onClick={onSignIn}>
              <LogIn className="w-4 h-4 mr-2" />
              Log in / Sign up
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
