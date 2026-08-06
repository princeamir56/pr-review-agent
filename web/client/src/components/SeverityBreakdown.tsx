import { motion } from "framer-motion";
import { CountUp } from "./CountUp";
import { cn } from "../lib/utils";

interface Breakdown { critical: number; high: number; medium: number; low: number }

const KEYS = ["critical", "high", "medium", "low"] as const;
const COLOR: Record<(typeof KEYS)[number], string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low"
};
const TEXT: Record<(typeof KEYS)[number], string> = {
  critical: "text-sev-critical",
  high: "text-sev-high",
  medium: "text-sev-medium",
  low: "text-sev-low"
};

export function SeverityBreakdown({ breakdown }: { breakdown: Breakdown }): JSX.Element {
  const total = breakdown.critical + breakdown.high + breakdown.medium + breakdown.low;
  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <h4 className="telemetry text-fg-muted">SEVERITY.BREAKDOWN</h4>
        <span className="text-xs text-fg-subtle">{total} finding{total === 1 ? "" : "s"}</span>
      </div>
      {total === 0 ? (
        <div className="text-sm text-sev-clean flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-sev-clean" />
          No security issues detected
        </div>
      ) : (
        <>
          <div className="flex h-2 rounded-full overflow-hidden bg-bg-2">
            {KEYS.map((k) => {
              const w = (breakdown[k] / total) * 100;
              if (w === 0) return null;
              return (
                <motion.div
                  key={k}
                  initial={{ width: 0 }}
                  animate={{ width: `${w}%` }}
                  transition={{ duration: 0.55, ease: "easeOut" }}
                  className={cn("h-full", COLOR[k])}
                />
              );
            })}
          </div>
          <div className="mt-3 grid grid-cols-4 gap-2 text-xs">
            {KEYS.map((k) => (
              <div key={k} className="flex items-center gap-1.5">
                <span className={cn("w-2 h-2 rounded-full", COLOR[k])} />
                <span className="capitalize text-fg-subtle">{k}</span>
                <span className={cn("ml-auto tabular-nums font-mono", TEXT[k])}>
                  <CountUp value={breakdown[k]} />
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
