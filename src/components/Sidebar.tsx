import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Page, User } from "@/types";
import {
  BookOpen,
  ChevronsLeft,
  ChevronsRight,
  FileText,
  Home,
  Lock,
  LogIn,
  LogOut,
  MessageSquare,
  Settings,
  Sparkles,
  Target,
  TrendingUp,
  X,
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
  /**
   * "static": desktop (always full width) and tablet (icon rail that can be expanded).
   * "drawer": the mobile menu, always full width with a close button.
   */
  variant?: "static" | "drawer";
  /** Tablet only: the rail is expanded to full width. */
  expanded?: boolean;
  onToggleExpanded?: () => void;
  onClose?: () => void;
}

export const NAV_ITEMS: Array<{ page: Page; label: string; icon: typeof Home }> = [
  { page: "home", label: "Home", icon: Home },
  { page: "analysis", label: "New Analysis", icon: FileText },
  { page: "results", label: "Results", icon: Target },
  { page: "assistant", label: "Career Assistant", icon: MessageSquare },
  { page: "roadmap", label: "Career Roadmap", icon: BookOpen },
  { page: "progress", label: "Progress", icon: TrendingUp },
  { page: "settings", label: "Settings", icon: Settings },
];

export function Logo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-cyan-500">
        <Sparkles className="h-4 w-4" aria-hidden="true" />
      </div>
      <div className={compact ? "hidden lg:block" : ""}>
        <p className="text-lg font-bold leading-tight">Skill2Hire</p>
        <p className="text-xs text-slate-400">Career Intelligence</p>
      </div>
    </div>
  );
}

export function Sidebar({
  currentPage,
  onNavigate,
  user,
  onLogout,
  onSignIn,
  lockedPages,
  variant = "static",
  expanded = false,
  onToggleExpanded,
  onClose,
}: SidebarProps) {
  const drawer = variant === "drawer";
  // On tablets the rail shows icons only unless expanded; desktops and the mobile drawer always show labels.
  const full = drawer || expanded;
  const label = full ? "" : "hidden lg:inline";
  const block = full ? "" : "hidden lg:block";

  return (
    <aside
      className={cn(
        "flex h-full shrink-0 flex-col bg-slate-900 text-white",
        drawer ? "w-72" : full ? "w-64" : "w-16 lg:w-64"
      )}
      aria-label="Main navigation"
    >
      <div className={cn("flex items-center justify-between gap-2 border-b border-slate-800", full ? "p-5" : "p-4 lg:p-5")}>
        <Logo compact={!full} />
        {drawer && (
          <Button variant="ghost" size="icon" className="text-slate-300 hover:bg-slate-800 hover:text-white" aria-label="Close menu" onClick={onClose} autoFocus>
            <X className="h-5 w-5" />
          </Button>
        )}
      </div>

      <nav className={cn("flex-1 space-y-1 overflow-y-auto", full ? "p-4" : "p-2 lg:p-4")}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.page;
          const locked = !user && lockedPages.has(item.page);
          return (
            <Button
              key={item.page}
              variant="ghost"
              aria-current={isActive ? "page" : undefined}
              aria-label={full ? undefined : item.label}
              title={locked ? `${item.label} - log in to use this` : full ? undefined : item.label}
              className={cn(
                "w-full text-slate-300 hover:bg-slate-800 hover:text-white",
                full ? "justify-start" : "justify-center px-0 lg:justify-start lg:px-4",
                isActive && "bg-slate-800 text-white",
                locked && "text-slate-500"
              )}
              onClick={() => onNavigate(item.page)}
            >
              <Icon className={cn("h-4 w-4 shrink-0", full ? "mr-3" : "lg:mr-3")} aria-hidden="true" />
              <span className={label}>{item.label}</span>
              {locked && <Lock className={cn("ml-auto h-3 w-3", full ? "" : "hidden lg:block")} aria-label="Requires login" />}
            </Button>
          );
        })}
      </nav>

      <div className={cn("space-y-3 border-t border-slate-800", full ? "p-4" : "p-2 lg:p-4")}>
        {user ? (
          <>
            <div className={cn("flex items-center gap-3", !full && "justify-center lg:justify-start")}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-slate-700 text-sm font-semibold" title={full ? undefined : user.name}>
                {user.name.charAt(0).toUpperCase()}
              </div>
              <div className={cn("min-w-0 flex-1", block)}>
                <p className="truncate text-sm font-medium">{user.name}</p>
                <p className="truncate text-xs text-slate-400">{user.email}</p>
              </div>
            </div>
            <Button
              variant="ghost"
              aria-label={full ? undefined : "Log out"}
              title={full ? undefined : "Log out"}
              className={cn("w-full text-slate-300 hover:bg-slate-800 hover:text-white", full ? "justify-start" : "justify-center px-0 lg:justify-start lg:px-4")}
              onClick={onLogout}
            >
              <LogOut className={cn("h-4 w-4 shrink-0", full ? "mr-3" : "lg:mr-3")} aria-hidden="true" />
              <span className={label}>Log out</span>
            </Button>
          </>
        ) : (
          <>
            <p className={cn("text-xs text-slate-400", block)}>You're using Skill2Hire as a guest. Log in to save results and run more analyses.</p>
            <Button
              aria-label={full ? undefined : "Log in or sign up"}
              title={full ? undefined : "Log in or sign up"}
              className={cn("w-full bg-cyan-500 text-slate-900 hover:bg-cyan-400", !full && "px-0 lg:px-4")}
              onClick={onSignIn}
            >
              <LogIn className={cn("h-4 w-4 shrink-0", full ? "mr-2" : "lg:mr-2")} aria-hidden="true" />
              <span className={label}>Log in / Sign up</span>
            </Button>
          </>
        )}
        {variant === "static" && onToggleExpanded && (
          <Button
            variant="ghost"
            className="w-full justify-center text-slate-400 hover:bg-slate-800 hover:text-white lg:hidden"
            aria-label={expanded ? "Collapse menu" : "Expand menu"}
            aria-expanded={expanded}
            onClick={onToggleExpanded}
          >
            {expanded ? <ChevronsLeft className="h-4 w-4" /> : <ChevronsRight className="h-4 w-4" />}
          </Button>
        )}
      </div>
    </aside>
  );
}
