import { createContext, useCallback, useContext, useState, useMemo } from "react";
import type { ReactNode } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { T } from "../lib/motion";

type Kind = "success" | "error" | "info";
interface Toast { id: number; kind: Kind; text: string }

const DURATION = 4000;

const Ctx = createContext<{ push(kind: Kind, text: string): void }>({ push: () => undefined });

export function useToast(): { push(kind: Kind, text: string): void } {
  return useContext(Ctx);
}

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [items, setItems] = useState<Toast[]>([]);
  const push = useCallback((kind: Kind, text: string): void => {
    const id = Date.now() + Math.random();
    setItems((s) => [...s, { id, kind, text }]);
    setTimeout(() => setItems((s) => s.filter((t) => t.id !== id)), DURATION);
  }, []);
  const value = useMemo(() => ({ push }), [push]);
  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2 w-[340px] pointer-events-none">
        <AnimatePresence>
          {items.map((t) => (
            <motion.div
              key={t.id}
              initial={{ opacity: 0, x: 40, scale: 0.98 }}
              animate={{ opacity: 1, x: 0, scale: 1 }}
              exit={{ opacity: 0, x: 20, scale: 0.98 }}
              transition={T.soft}
              className={cn(
                "glass relative overflow-hidden rounded-xl px-4 py-3 text-sm pointer-events-auto shadow-xl",
                t.kind === "success" && "border-sev-clean/40",
                t.kind === "error" && "border-sev-critical/40",
                t.kind === "info" && "border-accent/40"
              )}
            >
              <div className="flex items-start gap-2">
                <span className={cn(
                  "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                  t.kind === "success" && "bg-sev-clean",
                  t.kind === "error" && "bg-sev-critical",
                  t.kind === "info" && "bg-accent"
                )} />
                <div className="text-fg leading-snug">{t.text}</div>
              </div>
              <motion.div
                className={cn(
                  "absolute bottom-0 left-0 h-[2px]",
                  t.kind === "success" && "bg-sev-clean",
                  t.kind === "error" && "bg-sev-critical",
                  t.kind === "info" && "bg-accent"
                )}
                initial={{ width: "100%" }}
                animate={{ width: 0 }}
                transition={{ duration: DURATION / 1000, ease: "linear" }}
              />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
    </Ctx.Provider>
  );
}
