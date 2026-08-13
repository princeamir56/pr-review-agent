import { AnimatePresence, motion } from "framer-motion";
import { cn } from "../lib/utils";
import { T } from "../lib/motion";

/**
 * Actions for the PR detail sidebar. The post-comment toggle and "post latest
 * report" are compact action cards rather than plain rows, so the block reads as
 * the same card system as the agent selection above it.
 */

export function ActionsPanel({
  selectedCount,
  totalAgents,
  running,
  onRun,
  postComment,
  onPostCommentChange,
  onPostReport,
  posting,
  canPostReport
}: {
  selectedCount: number;
  totalAgents: number;
  running: boolean;
  onRun(): void;
  postComment: boolean;
  onPostCommentChange(v: boolean): void;
  onPostReport(): void;
  posting: boolean;
  canPostReport: boolean;
}): JSX.Element {
  const none = selectedCount === 0;
  const label = running
    ? "Running…"
    : none
      ? "Select an agent"
      : selectedCount === totalAgents
        ? "▶ Run full review"
        : `▶ Run ${selectedCount} agent${selectedCount === 1 ? "" : "s"}`;

  return (
    <div className="card p-4 space-y-3">
      <h3 className="telemetry text-fg-muted">ACTIONS</h3>

      <motion.button
        whileHover={running || none ? undefined : { y: -1 }}
        whileTap={running || none ? undefined : { y: 1, scale: 0.99 }}
        className={cn(
          "btn btn-primary justify-center h-10 w-full relative overflow-hidden",
          running && "opacity-70"
        )}
        disabled={running || none}
        onClick={onRun}
      >
        {running ? (
          <motion.span
            className="absolute inset-x-0 top-0 h-[2px] bg-gradient-to-r from-transparent via-white/80 to-transparent"
            initial={{ x: "-100%" }}
            animate={{ x: "100%" }}
            transition={{ duration: 1.4, repeat: Infinity, ease: "linear" }}
          />
        ) : null}
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={label}
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={T.micro}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </motion.button>

      <ToggleCard
        checked={postComment}
        onChange={onPostCommentChange}
        disabled={running}
        icon="💬"
        title="Post comment to GitHub"
        hint="Upserts the single review comment on this PR"
      />

      <motion.button
        whileHover={!canPostReport || posting ? undefined : { y: -1 }}
        whileTap={!canPostReport || posting ? undefined : { y: 1, scale: 0.99 }}
        onClick={onPostReport}
        disabled={!canPostReport || posting}
        className={cn(
          "w-full rounded-lg border border-line bg-bg-2 px-3 py-2.5 text-left",
          "flex items-center gap-3 transition-colors",
          !canPostReport || posting
            ? "opacity-55 cursor-not-allowed"
            : "hover:border-line-strong hover:bg-bg-3"
        )}
      >
        <span className="w-8 h-8 shrink-0 rounded-lg border border-line bg-bg-1 grid place-items-center text-base">
          📤
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-[13px] font-medium text-fg">
            {posting ? "Posting…" : "Post latest report"}
          </span>
          <span className="block text-[11px] text-fg-muted truncate mt-0.5">
            {canPostReport ? "Sends the saved report as a comment" : "No report saved yet"}
          </span>
        </span>
      </motion.button>
    </div>
  );
}

function ToggleCard({
  checked,
  onChange,
  disabled,
  icon,
  title,
  hint
}: {
  checked: boolean;
  onChange(v: boolean): void;
  disabled: boolean;
  icon: string;
  title: string;
  hint: string;
}): JSX.Element {
  return (
    <motion.button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      disabled={disabled}
      whileTap={disabled ? undefined : { scale: 0.99 }}
      className={cn(
        "w-full rounded-lg border px-3 py-2.5 text-left flex items-center gap-3 transition-colors",
        checked ? "border-accent/60 bg-accent/[0.07]" : "border-line bg-bg-2 hover:border-line-strong",
        disabled && "opacity-60 cursor-not-allowed"
      )}
    >
      <span className="w-8 h-8 shrink-0 rounded-lg border border-line bg-bg-1 grid place-items-center text-base">
        {icon}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-medium text-fg truncate">{title}</span>
        <span className="block text-[11px] text-fg-muted truncate mt-0.5">{hint}</span>
      </span>
      <Switch checked={checked} />
    </motion.button>
  );
}

function Switch({ checked }: { checked: boolean }): JSX.Element {
  return (
    <span
      className={cn(
        "shrink-0 w-9 h-5 rounded-full p-0.5 flex transition-colors",
        checked ? "bg-accent justify-end" : "bg-bg-3 justify-start"
      )}
    >
      <motion.span layout transition={T.spring} className="w-4 h-4 rounded-full bg-white shadow-sm" />
    </span>
  );
}
