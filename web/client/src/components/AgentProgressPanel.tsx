import { motion, AnimatePresence } from "framer-motion";
import type { AgentName } from "../lib/api";
import type { AgentUiState } from "../lib/realtime";
import { cn } from "../lib/utils";
import { T } from "../lib/motion";

const LABELS: Record<AgentName, string> = {
  summary: "SUMMARY",
  security: "SECURITY",
  documentation: "DOCS"
};

const STATE_LABEL: Record<AgentUiState, string> = {
  pending: "IDLE",
  running: "RUNNING",
  complete: "COMPLETE",
  error: "ERROR"
};

const STATE_TONE: Record<AgentUiState, string> = {
  pending: "border-line bg-bg-2 text-fg-subtle",
  running: "border-accent/50 bg-accent/10 text-accent",
  complete: "border-sev-clean/50 bg-sev-clean/10 text-sev-clean",
  error: "border-sev-critical/50 bg-sev-critical/10 text-sev-critical"
};

export function AgentProgressPanel({
  agents,
  active
}: {
  agents: Record<AgentName, AgentUiState>;
  active: boolean;
}): JSX.Element {
  return (
    <div className="card p-4 relative overflow-hidden">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <h3 className="telemetry text-fg-muted">AGENT.TELEMETRY</h3>
        </div>
        <span className={cn("telemetry", active ? "text-accent" : "text-fg-subtle")}>
          {active ? "◉ LIVE" : "○ IDLE"}
        </span>
      </div>
      <div className="space-y-1.5">
        {(Object.keys(LABELS) as AgentName[]).map((a) => (
          <AgentRow key={a} name={a} state={agents[a]} />
        ))}
      </div>
    </div>
  );
}

function AgentRow({ name, state }: { name: AgentName; state: AgentUiState }): JSX.Element {
  return (
    <motion.div
      layout
      className={cn(
        "relative overflow-hidden border rounded-lg px-3 py-2 flex items-center gap-3 transition-colors",
        STATE_TONE[state]
      )}
      animate={state === "error" ? { x: [0, -3, 3, -2, 2, 0] } : { x: 0 }}
      transition={state === "error" ? { duration: 0.35 } : T.micro}
    >
      {state === "running" ? (
        <motion.span
          className="absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-accent to-transparent"
          initial={{ x: "-100%" }}
          animate={{ x: "100%" }}
          transition={{ duration: 1.6, repeat: Infinity, ease: "linear" }}
        />
      ) : null}

      <StateIcon state={state} />

      <div className="min-w-0 flex-1">
        <div className="telemetry text-fg-muted">{LABELS[name]}</div>
      </div>

      <AnimatePresence mode="wait" initial={false}>
        <motion.span
          key={state}
          initial={{ opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={T.micro}
          className="telemetry"
        >
          {STATE_LABEL[state]}
        </motion.span>
      </AnimatePresence>
    </motion.div>
  );
}

function StateIcon({ state }: { state: AgentUiState }): JSX.Element {
  if (state === "pending") {
    return <span className="w-4 h-4 rounded-full border border-current opacity-40" />;
  }
  if (state === "running") {
    return (
      <span className="relative w-4 h-4 grid place-items-center">
        <motion.span
          className="absolute inset-0 rounded-full border border-accent/40"
          animate={{ scale: [1, 1.4, 1], opacity: [0.8, 0, 0.8] }}
          transition={{ duration: 1.4, repeat: Infinity }}
        />
        <span className="w-1.5 h-1.5 rounded-full bg-accent" />
      </span>
    );
  }
  if (state === "complete") {
    return (
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
        <motion.path
          d="M4 12l5 5L20 6"
          initial={{ pathLength: 0 }}
          animate={{ pathLength: 1 }}
          transition={{ duration: 0.35, ease: "easeOut" }}
        />
      </svg>
    );
  }
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round">
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  );
}
