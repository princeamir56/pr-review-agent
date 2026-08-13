import { useId, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { CountUp } from "./CountUp";
import { cn } from "../lib/utils";
import { T } from "../lib/motion";

interface Breakdown { critical: number; high: number; medium: number; low: number }

/**
 * Severity is an ordered status scale, so this is an ordinal bar chart: one row
 * per level, worst first, each bar measured against the largest count rather than
 * the total. A stacked bar was the wrong form here — at one finding it collapses
 * into a solid block that encodes nothing.
 *
 * Counts wear text tokens, never the severity hue: `sev-medium` sits at 2.94:1 on
 * a light card, well under the 4.5:1 text floor. The colored mark beside the
 * number carries identity instead.
 */

const KEYS = ["critical", "high", "medium", "low"] as const;
type Key = (typeof KEYS)[number];

const BAR: Record<Key, string> = {
  critical: "bg-sev-critical",
  high: "bg-sev-high",
  medium: "bg-sev-medium",
  low: "bg-sev-low"
};

export function SeverityBreakdown({ breakdown }: { breakdown: Breakdown }): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const total = KEYS.reduce((s, k) => s + breakdown[k], 0);
  const max = Math.max(...KEYS.map((k) => breakdown[k]), 1);
  const worst = KEYS.find((k) => breakdown[k] > 0) ?? null;
  const tableId = useId();
  const [showTable, setShowTable] = useState(false);

  return (
    <figure className="card p-4 m-0">
      <figcaption className="flex items-center justify-between gap-2 mb-3">
        <h4 className="telemetry text-fg-muted">SEVERITY.BREAKDOWN</h4>
        {total > 0 ? (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-expanded={showTable}
            aria-controls={tableId}
            className="text-[11px] text-fg-subtle hover:text-fg-muted transition-colors"
          >
            {showTable ? "Chart" : "Table"}
          </button>
        ) : null}
      </figcaption>

      {total === 0 ? (
        <CleanState />
      ) : (
        <>
          {/* Headline: the number is the story, the rows are the detail. */}
          <div className="flex items-baseline gap-2">
            <span className="font-display text-3xl font-semibold text-fg leading-none">
              <CountUp value={total} />
            </span>
            <span className="text-xs text-fg-muted">
              finding{total === 1 ? "" : "s"}
            </span>
            {worst ? (
              <span className="chip ml-auto capitalize">
                <span className={cn("w-1.5 h-1.5 rounded-full", BAR[worst])} />
                {worst} worst
              </span>
            ) : null}
          </div>

          {showTable ? (
            <SeverityTable id={tableId} breakdown={breakdown} total={total} />
          ) : (
            <div className="mt-3 space-y-1.5">
              {KEYS.map((k, i) => (
                <SeverityRow
                  key={k}
                  level={k}
                  count={breakdown[k]}
                  max={max}
                  total={total}
                  index={i}
                  reduced={reduced}
                />
              ))}
            </div>
          )}
        </>
      )}
    </figure>
  );
}

function SeverityRow({
  level,
  count,
  max,
  total,
  index,
  reduced
}: {
  level: Key;
  count: number;
  max: number;
  total: number;
  index: number;
  reduced: boolean;
}): JSX.Element {
  // Floor non-zero bars so a lone critical next to a hundred lows is still visible.
  const pct = count === 0 ? 0 : Math.max((count / max) * 100, 6);
  const share = total === 0 ? 0 : Math.round((count / total) * 100);
  const empty = count === 0;

  return (
    <div
      className={cn("group grid grid-cols-[64px_minmax(0,1fr)_20px] items-center gap-2", empty && "opacity-45")}
      title={`${count} ${level} · ${share}% of findings`}
    >
      <span className="text-[11px] capitalize text-fg-muted flex items-center gap-1.5 min-w-0">
        <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", BAR[level])} />
        <span className="truncate">{level}</span>
      </span>

      {/* Track + bar. Rounded data-end, square at the baseline. */}
      <span className="relative h-2 rounded-full bg-bg-2 overflow-hidden">
        {empty ? null : (
          <motion.span
            className={cn("absolute inset-y-0 left-0 rounded-r-[4px]", BAR[level])}
            initial={reduced ? false : { width: 0 }}
            animate={{ width: `${pct}%` }}
            transition={{ duration: 0.55, delay: 0.05 * index, ease: [0.2, 0, 0.2, 1] }}
          />
        )}
      </span>

      <span className="text-xs tabular-nums text-fg text-right font-medium">{count}</span>
    </div>
  );
}

function SeverityTable({
  id,
  breakdown,
  total
}: {
  id: string;
  breakdown: Breakdown;
  total: number;
}): JSX.Element {
  return (
    <motion.table
      id={id}
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={T.soft}
      className="mt-3 w-full text-xs border-collapse"
    >
      <thead>
        <tr className="text-fg-subtle">
          <th scope="col" className="text-left font-normal pb-1">Severity</th>
          <th scope="col" className="text-right font-normal pb-1">Count</th>
          <th scope="col" className="text-right font-normal pb-1">Share</th>
        </tr>
      </thead>
      <tbody>
        {KEYS.map((k) => (
          <tr key={k} className="border-t border-line">
            <td className="py-1 capitalize text-fg-muted">
              <span className="flex items-center gap-1.5">
                <span className={cn("w-1.5 h-1.5 rounded-full", BAR[k])} />
                {k}
              </span>
            </td>
            <td className="py-1 text-right tabular-nums text-fg">{breakdown[k]}</td>
            <td className="py-1 text-right tabular-nums text-fg-muted">
              {total === 0 ? "—" : `${Math.round((breakdown[k] / total) * 100)}%`}
            </td>
          </tr>
        ))}
      </tbody>
    </motion.table>
  );
}

function CleanState(): JSX.Element {
  return (
    <div className="flex items-center gap-2.5">
      <span className="w-8 h-8 rounded-full bg-sev-clean/15 grid place-items-center shrink-0">
        <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" className="text-sev-clean">
          <motion.path d="M4 12l5 5L20 6" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.4, ease: "easeOut" }} />
        </svg>
      </span>
      <div className="min-w-0">
        <div className="text-sm font-medium text-fg">No findings</div>
        <div className="text-[11px] text-fg-muted">Nothing flagged across all severities</div>
      </div>
    </div>
  );
}
