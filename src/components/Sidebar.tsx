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
  Shield,
  Sparkles,
} from "lucide-react";

interface SidebarProps {
  currentPage: Page;
  onNavigate: (page: Page) => void;
  user: User;
  onLogout: () => void;
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

export function Sidebar({ currentPage, onNavigate, user, onLogout }: SidebarProps) {
  return (
    <aside className="w-64 bg-slate-900 text-white flex flex-col">
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
          return (
            <Button
              key={item.page}
              variant="ghost"
              className={cn(
                "w-full justify-start text-slate-300 hover:text-white hover:bg-slate-800",
                isActive && "bg-slate-800 text-white"
              )}
              onClick={() => onNavigate(item.page)}
            >
              <Icon className="w-4 h-4 mr-3" />
              {item.label}
            </Button>
          );
        })}
      </nav>

      <div className="p-4 border-t border-slate-800 space-y-3">
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
      </div>
    </aside>
  );
}