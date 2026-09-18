import { Moon, Sun } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { useTheme } from "@/lib/theme";

/**
 * Switches between the light and dark theme. Until it is used, the app follows the device setting.
 * `tone="ink"` is for the always-dark surfaces (sidebar, mobile header).
 */
export function ThemeToggle({ tone = "default", showLabel = false, className = "" }: { tone?: "default" | "ink"; showLabel?: boolean; className?: string }) {
  const [isDark, toggle] = useTheme();
  const Icon = isDark ? Sun : Moon;
  const label = isDark ? "Switch to light theme" : "Switch to dark theme";
  return (
    <Button
      variant="ghost"
      size={showLabel ? "default" : "icon"}
      aria-label={label}
      title={label}
      aria-pressed={isDark}
      onClick={toggle}
      className={cn(
        showLabel ? "w-full justify-start" : "",
        tone === "ink" ? "text-ink-200 hover:bg-ink-800 hover:text-ink-50" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
        className
      )}
    >
      <Icon className={cn("h-4 w-4 shrink-0", showLabel && "mr-3")} aria-hidden="true" />
      {showLabel && <span>{isDark ? "Light theme" : "Dark theme"}</span>}
    </Button>
  );
}
