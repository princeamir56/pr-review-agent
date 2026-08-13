import { AnimatePresence, motion } from "framer-motion";
import type { AgentName } from "../lib/api";
import type { AgentUiState } from "../lib/realtime";
import { StateIcon, RunningSweep, STATE_LABEL, STATE_TEXT } from "./AgentProgressPanel";
import { cn } from "../lib/utils";
import { T, stagger } from "../lib/motion";

/**
 * The three agents as selectable cards — same icon/role/tone-dot language as the
 * pipeline nodes on the Home page, carrying over AgentProgressPanel's live state
 * machine (running sweep, checkmark draw, error shake).
 */

export const AGENTS: AgentName[] = ["summary", "security", "documentation"];

const META: Record<AgentName, { icon: string; title: string; role: string; dot: string }> = {
  summary: {
    icon: "📋",
    title: "Summary",
    role: "what / why / impact + complexity",
    dot: "bg-sev-low"
  },
  security: {
    icon: "🔒",
    title: "Security",
    role: "18 regex categories + scanner SARIF",
    dot: "bg-sev-critical"
  },
  documentation: {
    icon: "📚",
    title: "Documentation",
    role: "docstrings · README · changelog",
    dot: "bg-sev-clean"
  }
};

export function AgentSelectionPanel({
  agents,
  selected,
  onToggle,
  onSelectAll,
  active,
  disabled
}: {
  agents: Record<AgentName, AgentUiState>;
  selected: AgentName[];
  onToggle(agent: AgentName): void;
  onSelectAll(): void;
  active: boolean;
  disabled: boolean;
}): JSX.Element {
  const allSelected = selected.length === AGENTS.length;

  return (
    <div className="card p-4">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-accent" />
          <h3 className="telemetry text-fg-muted">AGENT.TELEMETRY</h3>
        </div>
        <span className={cn("telemetry", active ? "text-accent" : "text-fg-subtle")}>
          {active ? "◉ LIVE" : "○ IDLE"}
        </span>
      </div>

      <motion.div
        initial="initial"
        animate="animate"
        variants={stagger(0.06)}
        className="space-y-2"
      >
        {AGENTS.map((a) => (
          <AgentCard
            key={a}
            agent={a}
            state={agents[a]}
            selected={selected.includes(a)}
            onToggle={() => onToggle(a)}
            disabled={disabled}
          />
        ))}
      </motion.div>

      <div className="mt-3 flex items-center justify-between gap-2">
        <span className="text-[11px] text-fg-subtle tabular-nums">
          {selected.length} of {AGENTS.length} selected
        </span>
        <button
          type="button"
          onClick={onSelectAll}
          disabled={disabled || allSelected}
          className="text-[11px] text-accent hover:underline disabled:opacity-40 disabled:no-underline disabled:cursor-not-allowed"
        >
          Select all
        </button>
      </div>
    </div>
  );
}

function AgentCard({
  agent,
  state,
  selected,
  onToggle,
  disabled
}: {
  agent: AgentName;
  state: AgentUiState;
  selected: boolean;
  onToggle(): void;
  disabled: boolean;
}): JSX.Element {
  const meta = META[agent];

  return (
    <motion.button
      type="button"
      role="checkbox"
      aria-checked={selected}
      aria-label={`${meta.title} agent — ${STATE_LABEL[state].toLowerCase()}`}
      onClick={onToggle}
      disabled={disabled}
      variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }}
      transition={T.soft}
      whileHover={disabled ? undefined : { y: -1 }}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      animate={state === "error" ? { x: [0, -3, 3, -2, 2, 0] } : { x: 0 }}
      className={cn(
        "relative w-full overflow-hidden rounded-lg border px-3 py-2.5 text-left",
        "flex items-center gap-3 transition-colors",
        selected
          ? "border-accent/60 bg-accent/[0.07]"
          : "border-line bg-bg-2 hover:border-line-strong",
        disabled && "opacity-60 cursor-not-allowed"
      )}
    >
      {state === "running" ? <RunningSweep /> : null}

      {/* Selection ring — springs in on toggle, mirrors the accent underline elsewhere. */}
      <AnimatePresence>
        {selected ? (
          <motion.span
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.98 }}
            transition={T.spring}
            className="pointer-events-none absolute inset-0 rounded-lg ring-1 ring-inset ring-accent/45 shadow-[0_0_18px_-8px_rgb(var(--accent)/0.8)]"
          />
        ) : null}
      </AnimatePresence>

      <Checkbox selected={selected} />

      <span
        className={cn(
          "w-8 h-8 shrink-0 rounded-lg grid place-items-center text-base border transition-colors",
          selected ? "border-accent/40 bg-bg-1" : "border-line bg-bg-1"
        )}
      >
        {meta.icon}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className={cn("w-1.5 h-1.5 rounded-full shrink-0", meta.dot)} />
          <span className="text-[13px] font-medium text-fg truncate">{meta.title}</span>
        </span>
        <span className="block text-[11px] text-fg-muted leading-snug truncate mt-0.5">
          {meta.role}
        </span>
      </span>

      <span className={cn("shrink-0 flex items-center gap-1.5", STATE_TEXT[state])}>
        <StateIcon state={state} />
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={state}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={T.micro}
            className="telemetry hidden sm:inline lg:hidden xl:inline"
          >
            {STATE_LABEL[state]}
          </motion.span>
        </AnimatePresence>
      </span>
    </motion.button>
  );
}

function Checkbox({ selected }: { selected: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        "w-4 h-4 shrink-0 rounded-[5px] border grid place-items-center transition-colors",
        selected ? "border-accent bg-accent text-white" : "border-line-strong bg-bg-1"
      )}
    >
      <AnimatePresence initial={false}>
        {selected ? (
          <motion.svg
            key="tick"
            width="11"
            height="11"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="3.4"
            strokeLinecap="round"
            strokeLinejoin="round"
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.6 }}
            transition={T.micro}
          >
            <path d="M4 12l5 5L20 6" />
          </motion.svg>
        ) : null}
      </AnimatePresence>
    </span>
  );
}
