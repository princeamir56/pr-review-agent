import { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";

export type Theme = "light" | "dark" | "system";
export type Resolved = "light" | "dark";

interface Ctx {
  theme: Theme;
  resolved: Resolved;
  setTheme(t: Theme): void;
  toggle(): void;
}

const THEME_KEY = "pr-agent-theme";
const ThemeCtx = createContext<Ctx>({
  theme: "system",
  resolved: "dark",
  setTheme: () => undefined,
  toggle: () => undefined
});

function readInitial(): Theme {
  if (typeof window === "undefined") return "system";
  const raw = localStorage.getItem(THEME_KEY);
  return raw === "light" || raw === "dark" || raw === "system" ? raw : "system";
}

function systemPref(): Resolved {
  if (typeof window === "undefined") return "dark";
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

function apply(resolved: Resolved): void {
  const root = document.documentElement;
  root.classList.remove("light", "dark");
  root.classList.add(resolved);
}

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setThemeState] = useState<Theme>(readInitial);
  const [systemNow, setSystemNow] = useState<Resolved>(systemPref);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const listener = (e: MediaQueryListEvent): void => setSystemNow(e.matches ? "dark" : "light");
    mq.addEventListener("change", listener);
    return () => mq.removeEventListener("change", listener);
  }, []);

  const resolved: Resolved = theme === "system" ? systemNow : theme;

  useEffect(() => { apply(resolved); }, [resolved]);

  const setTheme = useCallback((t: Theme): void => {
    localStorage.setItem(THEME_KEY, t);
    setThemeState(t);
  }, []);

  const toggle = useCallback((): void => {
    setTheme(resolved === "dark" ? "light" : "dark");
  }, [resolved, setTheme]);

  const value = useMemo<Ctx>(() => ({ theme, resolved, setTheme, toggle }), [theme, resolved, setTheme, toggle]);
  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>;
}

export function useTheme(): Ctx {
  return useContext(ThemeCtx);
}
