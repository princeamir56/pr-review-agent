import { useEffect, useRef, useState } from "react";
import { motion, useReducedMotion } from "framer-motion";
import { T } from "../lib/motion";
import { cn } from "../lib/utils";

/**
 * n8n-style canvas of the real orchestrator flow. Nodes are absolutely positioned
 * cards on a fixed 1120x800 coordinate grid; the SVG behind them uses the same
 * grid so edges land exactly on node ports. The whole canvas scales down with the
 * container on narrow viewports, and collapses to a vertical list under `md`.
 */

const W = 1120;
const H = 800;

type Tone = "accent" | "clean" | "low" | "medium" | "high" | "critical" | "muted";

interface Node {
  id: string;
  x: number;
  y: number;
  w: number;
  icon: string;
  title: string;
  role: string;
  tone: Tone;
  dashed?: boolean;
  /** Order in the reveal stagger. */
  step: number;
}

const NODE_H = 84;

const NODES: Node[] = [
  { id: "pr", x: 400, y: 0, w: 320, icon: "🔀", title: "GitHub Pull Request", role: "diff · files · commits · metadata", tone: "muted", step: 0 },
  { id: "orch", x: 400, y: 140, w: 320, icon: "🧠", title: "Orchestrator", role: "one fetch, then fan out in parallel", tone: "accent", step: 1 },

  { id: "summary", x: 20, y: 300, w: 336, icon: "📋", title: "Summary", role: "what / why / impact + complexity score", tone: "low", step: 2 },
  { id: "security", x: 392, y: 300, w: 336, icon: "🔒", title: "Security", role: "18 regex categories + Semgrep/Gitleaks/Trivy SARIF", tone: "critical", step: 2 },
  { id: "docs", x: 764, y: 300, w: 336, icon: "📚", title: "Documentation", role: "docstrings · README · changelog gaps", tone: "clean", step: 2 },

  { id: "llm", x: 400, y: 452, w: 320, icon: "🤖", title: "LLM pass", role: "optional — logic gaps + false-positive triage", tone: "medium", dashed: true, step: 3 },

  { id: "merge", x: 400, y: 580, w: 320, icon: "🧩", title: "Merge", role: "one canonical report + review decision", tone: "accent", step: 4 },

  { id: "comment", x: 0, y: 716, w: 262, icon: "💬", title: "Upsert PR comment", role: "exactly one, edited in place", tone: "low", step: 5 },
  { id: "inline", x: 286, y: 716, w: 262, icon: "📍", title: "Inline comments", role: "high + critical, on the diff lines", tone: "high", step: 5 },
  { id: "report", x: 572, y: 716, w: 262, icon: "📄", title: "docs/pr-reviews/", role: "PR-{n}-{date}-{sha}.md", tone: "clean", step: 5 },
  { id: "metrics", x: 858, y: 716, w: 262, icon: "📈", title: "runs.jsonl", role: "one metrics row → trends", tone: "medium", step: 5 }
];

const TONE_RING: Record<Tone, string> = {
  accent: "border-accent/50 shadow-[0_0_0_1px_rgb(var(--accent)/0.12),0_10px_30px_-18px_rgb(var(--accent)/0.7)]",
  clean: "border-sev-clean/40",
  low: "border-sev-low/40",
  medium: "border-sev-medium/40",
  high: "border-sev-high/40",
  critical: "border-sev-critical/40",
  muted: "border-line"
};

const TONE_DOT: Record<Tone, string> = {
  accent: "bg-accent",
  clean: "bg-sev-clean",
  low: "bg-sev-low",
  medium: "bg-sev-medium",
  high: "bg-sev-high",
  critical: "bg-sev-critical",
  muted: "bg-fg-subtle"
};

const TONE_STROKE: Record<Tone, string> = {
  accent: "rgb(var(--accent))",
  clean: "rgb(var(--sev-clean))",
  low: "rgb(var(--sev-low))",
  medium: "rgb(var(--sev-medium))",
  high: "rgb(var(--sev-high))",
  critical: "rgb(var(--sev-critical))",
  muted: "rgb(var(--line-strong))"
};

interface Edge {
  id: string;
  d: string;
  tone: Tone;
  dashed?: boolean;
  /** Reveal order — matches the step of the node it feeds. */
  step: number;
}

/** Vertical S-curve from (x1,y1) down to (x2,y2). */
function curve(x1: number, y1: number, x2: number, y2: number): string {
  const dy = (y2 - y1) / 2;
  return `M ${x1} ${y1} C ${x1} ${y1 + dy}, ${x2} ${y2 - dy}, ${x2} ${y2}`;
}

const bottom = (n: Node): [number, number] => [n.x + n.w / 2, n.y + NODE_H];
const top = (n: Node): [number, number] => [n.x + n.w / 2, n.y];

const byId = (id: string): Node => NODES.find((n) => n.id === id)!;

function edge(id: string, from: string, to: string, tone: Tone, step: number, dashed?: boolean): Edge {
  const [x1, y1] = bottom(byId(from));
  const [x2, y2] = top(byId(to));
  return { id, d: curve(x1, y1, x2, y2), tone, step, dashed };
}

const EDGES: Edge[] = [
  edge("pr-orch", "pr", "orch", "muted", 1),
  edge("orch-summary", "orch", "summary", "low", 2),
  edge("orch-security", "orch", "security", "critical", 2),
  edge("orch-docs", "orch", "docs", "clean", 2),
  edge("summary-llm", "summary", "llm", "medium", 3, true),
  edge("security-llm", "security", "llm", "medium", 3, true),
  edge("docs-llm", "docs", "llm", "medium", 3, true),
  edge("llm-merge", "llm", "merge", "accent", 4),
  edge("merge-comment", "merge", "comment", "low", 5),
  edge("merge-inline", "merge", "inline", "high", 5),
  edge("merge-report", "merge", "report", "clean", 5),
  edge("merge-metrics", "merge", "metrics", "medium", 5)
];

export function PipelineDiagram(): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const frameRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);
  const [frameWidth, setFrameWidth] = useState(W);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return;
    const apply = (): void => {
      const width = frame.clientWidth;
      setFrameWidth(width);
      // Never scale past 1 — the canvas is designed at W and shouldn't be blown up.
      setScale(Math.min(width / W, 1));
    };
    apply();
    const ro = new ResizeObserver(apply);
    ro.observe(frame);
    return () => ro.disconnect();
  }, []);

  // Once the frame is wider than the canvas, the scale clamps at 1 and the extra
  // space would otherwise all pool on the right — center the canvas in it instead.
  const offsetX = Math.max((frameWidth - W * scale) / 2, 0);

  return (
    <div className="card overflow-hidden">
      <div className="flex items-center justify-between gap-4 border-b border-line px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <span className="telemetry text-fg-muted truncate">ORCHESTRATOR.FLOW</span>
        </div>
        <div className="hidden sm:flex items-center gap-3 text-[10px] text-fg-subtle">
          <LegendKey label="parallel" />
          <LegendKey label="optional" dashed />
        </div>
      </div>

      {/* Canvas — scales with the container, hidden on small screens.
          overflow-hidden matters: transform: scale() shrinks how the canvas paints
          but not the 1120px box it occupies, so without clipping it widens the page. */}
      <div className="hidden md:block relative bg-bg-0/40 px-4 py-6 overflow-hidden">
        <div ref={frameRef} className="relative w-full overflow-hidden" style={{ height: H * scale }}>
          <div
            className="absolute top-0 origin-top-left"
            style={{ left: offsetX, width: W, height: H, transform: `scale(${scale})` }}
          >
            <Wires reduced={reduced} />
            {NODES.map((n) => (
              <NodeCard key={n.id} node={n} reduced={reduced} />
            ))}
          </div>
        </div>
      </div>

      {/* Small screens: the same flow as a readable vertical list. */}
      <div className="md:hidden divide-y divide-line">
        {NODES.map((n) => (
          <MobileRow key={n.id} node={n} />
        ))}
      </div>
    </div>
  );
}

function Wires({ reduced }: { reduced: boolean }): JSX.Element {
  return (
    <svg
      className="absolute inset-0 pointer-events-none"
      width={W}
      height={H}
      viewBox={`0 0 ${W} ${H}`}
      fill="none"
      aria-hidden="true"
    >
      {EDGES.map((e) => {
        const stroke = TONE_STROKE[e.tone];
        const delay = 0.12 * e.step;
        return (
          <g key={e.id}>
            {/* Base track */}
            <motion.path
              d={e.d}
              stroke={stroke}
              strokeOpacity={e.dashed ? 0.32 : 0.42}
              strokeWidth={1.5}
              strokeLinecap="round"
              strokeDasharray={e.dashed ? "5 6" : undefined}
              initial={reduced ? false : { pathLength: 0, opacity: 0 }}
              whileInView={reduced ? undefined : { pathLength: 1, opacity: 1 }}
              viewport={{ once: true, margin: "-60px" }}
              transition={{ duration: 0.6, delay, ease: "easeOut" }}
            />
            {/* Flowing pulse along the same path */}
            {reduced ? null : (
              <motion.path
                d={e.d}
                stroke={stroke}
                strokeWidth={2.5}
                strokeLinecap="round"
                pathLength={1}
                strokeDasharray="0.16 0.84"
                initial={{ strokeDashoffset: 1, opacity: 0 }}
                whileInView={{ strokeDashoffset: [1, 0], opacity: [0, 0.9, 0.9, 0] }}
                viewport={{ once: true, margin: "-60px" }}
                transition={{
                  duration: 2.2,
                  delay: 0.7 + delay,
                  repeat: Infinity,
                  repeatDelay: 0.9,
                  ease: "linear",
                  opacity: {
                    duration: 2.2,
                    delay: 0.7 + delay,
                    repeat: Infinity,
                    repeatDelay: 0.9,
                    times: [0, 0.12, 0.85, 1]
                  }
                }}
              />
            )}
          </g>
        );
      })}
    </svg>
  );
}

function NodeCard({ node, reduced }: { node: Node; reduced: boolean }): JSX.Element {
  return (
    <motion.div
      className={cn(
        "absolute card glass px-4 flex items-center gap-3",
        TONE_RING[node.tone],
        node.dashed && "border-dashed"
      )}
      style={{ left: node.x, top: node.y, width: node.w, height: NODE_H }}
      initial={reduced ? false : { opacity: 0, y: 14, scale: 0.97 }}
      whileInView={reduced ? undefined : { opacity: 1, y: 0, scale: 1 }}
      viewport={{ once: true, margin: "-60px" }}
      transition={{ ...T.soft, delay: 0.12 * node.step }}
      whileHover={{ y: -2 }}
    >
      <span className="w-10 h-10 shrink-0 rounded-lg bg-bg-2 border border-line grid place-items-center text-lg">
        {node.icon}
      </span>
      <div className="min-w-0">
        <div className="flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", TONE_DOT[node.tone])} />
          <span className="font-medium text-fg text-[13px] truncate">{node.title}</span>
        </div>
        <div className="text-[11px] text-fg-muted leading-snug mt-1 line-clamp-2">{node.role}</div>
      </div>
    </motion.div>
  );
}

function MobileRow({ node }: { node: Node }): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, x: -6 }}
      whileInView={{ opacity: 1, x: 0 }}
      viewport={{ once: true, margin: "-40px" }}
      transition={T.soft}
      className="flex items-start gap-3 px-4 py-3"
    >
      <span className="w-9 h-9 shrink-0 rounded-lg bg-bg-2 border border-line grid place-items-center text-base">
        {node.icon}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", TONE_DOT[node.tone])} />
          <span className="font-medium text-fg text-sm">{node.title}</span>
          {node.dashed ? <span className="chip text-[10px] py-0">optional</span> : null}
        </div>
        <div className="text-xs text-fg-muted mt-0.5 leading-snug">{node.role}</div>
      </div>
    </motion.div>
  );
}

function LegendKey({ label, dashed }: { label: string; dashed?: boolean }): JSX.Element {
  return (
    <span className="flex items-center gap-1.5">
      <svg width="20" height="6" viewBox="0 0 20 6" aria-hidden="true">
        <path
          d="M0 3 H20"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeDasharray={dashed ? "4 4" : undefined}
          opacity={0.7}
        />
      </svg>
      {label}
    </span>
  );
}
