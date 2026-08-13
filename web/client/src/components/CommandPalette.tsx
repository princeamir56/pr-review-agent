import { useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../lib/api";
import { useTheme } from "../lib/theme";
import { T } from "../lib/motion";
import { cn } from "../lib/utils";

interface Cmd {
  id: string;
  title: string;
  hint?: string;
  group: string;
  keywords: string;
  run(): void;
}

export function CommandPalette({
  open,
  onClose
}: {
  open: boolean;
  onClose(): void;
}): JSX.Element {
  const navigate = useNavigate();
  const { setTheme, resolved } = useTheme();
  const [q, setQ] = useState("");
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const openPRs = useQuery({ queryKey: ["prs", "open"], queryFn: api.listOpen, enabled: open });

  useEffect(() => {
    if (open) {
      setQ("");
      setCursor(0);
      setTimeout(() => inputRef.current?.focus(), 20);
    }
  }, [open]);

  const items = useMemo<Cmd[]>(() => {
    const cmds: Cmd[] = [
      { id: "nav:home", title: "Go to Home", group: "Navigate", keywords: "landing overview pipeline how it works", run: () => navigate("/") },
      { id: "nav:dash", title: "Go to Dashboard", group: "Navigate", keywords: "prs pull requests list", run: () => navigate("/dashboard") },
      { id: "nav:reports", title: "Go to Reports", group: "Navigate", keywords: "docs pr-reviews", run: () => navigate("/reports") },
      { id: "nav:settings", title: "Open Settings", group: "Navigate", keywords: "config token github anthropic ollama", run: () => navigate("/settings") },
      { id: "theme:toggle", title: `Switch to ${resolved === "dark" ? "light" : "dark"} theme`, group: "Theme", keywords: "dark light mode", run: () => setTheme(resolved === "dark" ? "light" : "dark") },
      { id: "theme:system", title: "Use system theme", group: "Theme", keywords: "auto system", run: () => setTheme("system") }
    ];
    for (const pr of openPRs.data?.prs ?? []) {
      cmds.push({
        id: `pr:${pr.number}`,
        title: `#${pr.number} · ${pr.title}`,
        hint: `@${pr.author} · ${pr.headBranch}`,
        group: "Open pull requests",
        keywords: `${pr.number} ${pr.title} ${pr.author} ${pr.headBranch}`,
        run: () => navigate(`/pr/${pr.number}`)
      });
    }
    return cmds;
  }, [navigate, openPRs.data, resolved, setTheme]);

  const filtered = useMemo(() => {
    if (!q.trim()) return items;
    const needle = q.toLowerCase();
    return items
      .map((c) => {
        const hay = `${c.title} ${c.keywords}`.toLowerCase();
        let score = 0;
        if (hay.includes(needle)) score += 5;
        for (const t of needle.split(/\s+/)) if (t && hay.includes(t)) score += 1;
        return { c, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((x) => x.c);
  }, [items, q]);

  useEffect(() => { setCursor(0); }, [q]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowDown") { e.preventDefault(); setCursor((c) => Math.min(c + 1, filtered.length - 1)); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setCursor((c) => Math.max(0, c - 1)); }
      else if (e.key === "Enter") {
        const item = filtered[cursor];
        if (item) { item.run(); onClose(); }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, filtered, cursor, onClose]);

  const groups = useMemo(() => {
    const map = new Map<string, Cmd[]>();
    for (const c of filtered) {
      const list = map.get(c.group) ?? [];
      list.push(c);
      map.set(c.group, list);
    }
    return [...map.entries()];
  }, [filtered]);

  let idx = -1;

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[15vh]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={T.soft}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-bg-0/60 backdrop-blur-sm" />
          <motion.div
            className="glass relative w-full max-w-xl rounded-2xl overflow-hidden shadow-2xl"
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 4, scale: 0.98 }}
            transition={T.soft}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center gap-2 border-b border-line px-4 py-3">
              <SearchIcon />
              <input
                ref={inputRef}
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Jump to a PR, page, or action…"
                className="flex-1 bg-transparent outline-none text-sm text-fg placeholder:text-fg-subtle"
              />
              <span className="kbd">ESC</span>
            </div>
            <div className="max-h-[50vh] overflow-y-auto p-1.5">
              {filtered.length === 0 ? (
                <div className="px-4 py-8 text-center text-sm text-fg-subtle">No results.</div>
              ) : (
                groups.map(([group, list]) => (
                  <div key={group} className="mb-1">
                    <div className="telemetry text-fg-subtle px-3 py-1.5">{group}</div>
                    {list.map((c) => {
                      idx += 1;
                      const active = idx === cursor;
                      return (
                        <button
                          key={c.id}
                          onMouseEnter={() => setCursor(idx)}
                          onClick={() => { c.run(); onClose(); }}
                          className={cn(
                            "w-full text-left px-3 py-2 rounded-lg flex items-center gap-3 transition-colors",
                            active ? "bg-accent/15 text-fg" : "text-fg-muted hover:bg-bg-2"
                          )}
                        >
                          <span className="flex-1 truncate text-sm">{c.title}</span>
                          {c.hint ? <span className="text-[11px] font-mono text-fg-subtle truncate">{c.hint}</span> : null}
                        </button>
                      );
                    })}
                  </div>
                ))
              )}
            </div>
            <div className="border-t border-line px-4 py-2 flex items-center gap-3 text-[11px] text-fg-subtle">
              <span><span className="kbd">↑</span> <span className="kbd">↓</span> navigate</span>
              <span><span className="kbd">↵</span> select</span>
              <span className="ml-auto">Cmd/Ctrl + K anywhere</span>
            </div>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

function SearchIcon(): JSX.Element {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="text-fg-subtle">
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.5-3.5" />
    </svg>
  );
}
