import { Button } from "@/components/ui/button";
import { ThemeToggle } from "@/components/ThemeToggle";
import { cn } from "@/lib/utils";
import type { Page, User } from "@/types";
import {
  BookOpen,
  FileText,
  Home,
  LogIn,
  LogOut,
  MessageSquare,
  PanelLeftClose,
  PanelLeftOpen,
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
  /**
   * "static": the sidebar beside the page, collapsible to an icon rail at any width.
   * "drawer": the mobile menu, always full width with a close button.
   */
  variant?: "static" | "drawer";
  collapsed?: boolean;
  onToggleCollapsed?: () => void;
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
      <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-parrot-500">
        <Sparkles className="h-4 w-4 text-ink-950" aria-hidden="true" />
      </div>
      {!compact && (
        <div>
          <p className="font-display text-lg font-bold leading-tight text-ink-50">Skill2Hire</p>
          <p className="text-xs text-ink-300">Career Intelligence</p>
        </div>
      )}
    </div>
  );
}

export function Sidebar({
  currentPage,
  onNavigate,
  user,
  onLogout,
  onSignIn,
  variant = "static",
  collapsed = false,
  onToggleCollapsed,
  onClose,
}: SidebarProps) {
  const drawer = variant === "drawer";
  // The drawer is always full width; the static sidebar follows the collapse setting at every screen size.
  const full = drawer || !collapsed;

  return (
    <aside
      className={cn("flex h-full shrink-0 flex-col bg-ink-900 text-ink-100 transition-[width] duration-200", drawer ? "w-72" : full ? "w-64" : "w-20")}
      aria-label="Main navigation"
    >
      <div className={cn("flex items-center gap-2 border-b border-ink-800", full ? "justify-between p-5" : "flex-col p-3")}>
        <Logo compact={!full} />
        {drawer ? (
          <Button variant="ghost" size="icon" className="text-ink-200 hover:bg-ink-800 hover:text-ink-50" aria-label="Close menu" onClick={onClose} autoFocus>
            <X className="h-5 w-5" />
          </Button>
        ) : (
          <Button
            variant="ghost"
            size="icon"
            className="text-ink-300 hover:bg-ink-800 hover:text-ink-50"
            aria-label={collapsed ? "Expand menu" : "Collapse menu"}
            aria-expanded={!collapsed}
            title={collapsed ? "Expand menu" : "Collapse menu"}
            onClick={onToggleCollapsed}
          >
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </Button>
        )}
      </div>

      <nav className={cn("flex-1 space-y-1 overflow-y-auto", full ? "p-4" : "p-2")}>
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const isActive = currentPage === item.page;
          return (
            <Button
              key={item.page}
              variant="ghost"
              aria-current={isActive ? "page" : undefined}
              aria-label={full ? undefined : item.label}
              title={full ? undefined : item.label}
              className={cn(
                "w-full text-ink-200 hover:bg-ink-800 hover:text-ink-50",
                full ? "justify-start" : "justify-center px-0",
                isActive && "bg-ink-800 text-ink-50"
              )}
              onClick={() => onNavigate(item.page)}
            >
              <Icon className={cn("h-4 w-4 shrink-0", full && "mr-3")} aria-hidden="true" />
              {full && <span>{item.label}</span>}
            </Button>
          );
        })}
      </nav>

      <div className={cn("space-y-2 border-t border-ink-800", full ? "p-4" : "p-2")}>
        <ThemeToggle tone="ink" showLabel={full} className={full ? "" : "w-full"} />
        {user ? (
          <>
            <div className={cn("flex items-center gap-3", !full && "justify-center")}>
              <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-ink-700 text-sm font-semibold text-ink-50" title={full ? undefined : user.name}>
                {user.name.charAt(0).toUpperCase()}
              </div>
              {full && (
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-medium text-ink-50">{user.name}</p>
                  <p className="truncate text-xs text-ink-300">{user.email}</p>
                </div>
              )}
            </div>
            <Button
              variant="ghost"
              aria-label={full ? undefined : "Log out"}
              title={full ? undefined : "Log out"}
              className={cn("w-full text-ink-200 hover:bg-ink-800 hover:text-ink-50", full ? "justify-start" : "justify-center px-0")}
              onClick={onLogout}
            >
              <LogOut className={cn("h-4 w-4 shrink-0", full && "mr-3")} aria-hidden="true" />
              {full && <span>Log out</span>}
            </Button>
          </>
        ) : (
          <>
            {full && <p className="text-xs text-ink-300">You're using Skill2Hire as a guest. Log in to save results and run more analyses.</p>}
            <Button
              aria-label={full ? undefined : "Log in or sign up"}
              title={full ? undefined : "Log in or sign up"}
              className={cn("w-full bg-parrot-500 text-ink-950 hover:bg-parrot-400", !full && "px-0")}
              onClick={onSignIn}
            >
              <LogIn className={cn("h-4 w-4 shrink-0", full && "mr-2")} aria-hidden="true" />
              {full && <span>Log in / Sign up</span>}
            </Button>
          </>
        )}
      </div>
    </aside>
  );
}
