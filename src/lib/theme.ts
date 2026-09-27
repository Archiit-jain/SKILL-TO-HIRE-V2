import { useSyncExternalStore } from "react";

/**
 * Light/dark theme. Without a stored choice the system setting is followed (and tracked live); the toggle stores an
 * explicit choice in localStorage. The class is applied before first paint by public/theme-init.js.
 */
const KEY = "s2h-theme";
const listeners = new Set<() => void>();

const media = () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia("(prefers-color-scheme: dark)") : null);

function stored(): "light" | "dark" | null {
  try {
    const value = localStorage.getItem(KEY);
    return value === "light" || value === "dark" ? value : null;
  } catch {
    return null; // private mode or blocked storage
  }
}

const systemPrefersDark = () => media()?.matches ?? false;

function apply(dark: boolean) {
  document.documentElement.classList.toggle("dark", dark);
  listeners.forEach((l) => l());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const mq = media();
  const onSystemChange = () => {
    // Only follow the system while the user hasn't chosen explicitly.
    if (!stored()) apply(systemPrefersDark());
  };
  mq?.addEventListener("change", onSystemChange);
  return () => {
    listeners.delete(listener);
    mq?.removeEventListener("change", onSystemChange);
  };
}

const isDarkNow = () => (typeof document !== "undefined" ? document.documentElement.classList.contains("dark") : false);

export function setTheme(dark: boolean) {
  try {
    localStorage.setItem(KEY, dark ? "dark" : "light");
  } catch {
    /* choice just won't be remembered */
  }
  apply(dark);
}

/** `[isDark, toggle]` for the theme switch. */
export function useTheme(): [boolean, () => void] {
  const isDark = useSyncExternalStore(subscribe, isDarkNow, () => false);
  return [isDark, () => setTheme(!isDark)];
}
