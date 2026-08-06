import { useEffect, useState } from "react";
import { NavLink, Outlet, useLocation } from "react-router-dom";
import { motion } from "framer-motion";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { T } from "../lib/motion";
import { cn } from "../lib/utils";
import { ThemeToggle } from "./ThemeToggle";
import { CommandPalette } from "./CommandPalette";

const nav = [
  { to: "/", label: "Dashboard", end: true },
  { to: "/reports", label: "Reports", end: false },
  { to: "/settings", label: "Settings", end: false }
];

export function Layout(): JSX.Element {
  const repo = useQuery({ queryKey: ["repo"], queryFn: api.repo });
  const location = useLocation();
  const [paletteOpen, setPaletteOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="min-h-screen flex flex-col">
      <header className="glass border-b sticky top-0 z-30">
        <div className="max-w-[1400px] mx-auto px-6 h-14 flex items-center gap-4">
          <div className="flex items-center gap-3 min-w-0">
            <div className="w-7 h-7 rounded-lg bg-gradient-to-br from-accent to-sev-critical/70 grid place-items-center text-white text-xs font-bold shadow-[0_2px_10px_-2px_rgb(var(--accent)/0.6)]">
              P
            </div>
            <div className="font-display font-semibold tracking-tightest text-fg">PR Review Agent</div>
            <span className="text-fg-subtle">/</span>
            <span className="text-fg-muted text-sm font-mono truncate">
              {repo.data ? `${repo.data.owner}/${repo.data.repo}` : "detecting…"}
            </span>
          </div>

          <div className="flex-1" />

          <button
            onClick={() => setPaletteOpen(true)}
            className="hidden md:flex items-center gap-2 px-3 h-9 rounded-lg border border-line bg-bg-2 text-sm text-fg-subtle hover:bg-bg-3 hover:text-fg-muted transition-colors"
            aria-label="Open command palette"
          >
            <span>Jump to…</span>
            <span className="kbd">⌘K</span>
          </button>

          <nav className="flex items-center gap-1">
            {nav.map((n) => (
              <NavLink
                key={n.to}
                to={n.to}
                end={n.end}
                className={({ isActive }) =>
                  cn(
                    "relative px-3 py-1.5 rounded-lg text-sm font-medium transition-colors",
                    isActive ? "text-fg" : "text-fg-muted hover:text-fg"
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <span className="relative z-10">{n.label}</span>
                    {isActive ? (
                      <motion.span
                        layoutId="nav-underline"
                        className="absolute inset-x-2 -bottom-[7px] h-[2px] rounded-full bg-accent shadow-[0_0_10px_rgb(var(--accent)/0.6)]"
                        transition={T.spring}
                      />
                    ) : null}
                  </>
                )}
              </NavLink>
            ))}
          </nav>
          <ThemeToggle />
        </div>
      </header>

      <main className="flex-1 max-w-[1400px] w-full mx-auto px-6 py-8">
        <motion.div
          key={location.pathname}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={T.page}
        >
          <Outlet />
        </motion.div>
      </main>

      <footer className="border-t border-line py-4 text-center text-xs text-fg-subtle">
        Dashboard · reuses the deterministic orchestrator from the VS Code extension and CLI.
      </footer>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  );
}
