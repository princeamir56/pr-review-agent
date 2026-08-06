import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import type { OpenPR, ClosedPR } from "../lib/api";
import { StatusBadge } from "./StatusBadge";
import { Avatar } from "./Avatar";
import { formatRelative } from "../lib/utils";
import { T } from "../lib/motion";

interface Props {
  pr: (OpenPR | ClosedPR) & { merged?: boolean; closedAt?: string | null };
  kind: "open" | "closed";
}

export function PRCard({ pr, kind }: Props): JSX.Element {
  const badge =
    kind === "open" ? <StatusBadge kind="open">open</StatusBadge>
    : pr.merged ? <StatusBadge kind="merged">merged</StatusBadge>
    : <StatusBadge kind="closed">closed</StatusBadge>;

  return (
    <motion.div
      layout
      variants={{
        initial: { opacity: 0, y: 8 },
        animate: { opacity: 1, y: 0 },
        exit: { opacity: 0, y: -4, scale: 0.99 }
      }}
      transition={T.soft}
      whileHover={{ y: -1 }}
      className="group"
    >
      <Link
        to={`/pr/${pr.number}`}
        className="card block p-4 relative overflow-hidden hover:border-line-strong transition-colors"
      >
        <span className="absolute left-0 top-0 h-full w-[2px] bg-gradient-to-b from-accent to-transparent opacity-0 group-hover:opacity-100 transition-opacity" />
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2 text-xs text-fg-subtle mb-1.5">
              <span className="font-mono text-fg-muted">#{pr.number}</span>
              <span>·</span>
              <Avatar name={pr.author} size={16} />
              <span className="text-fg-muted">@{pr.author}</span>
              <span>·</span>
              <span>{formatRelative(pr.createdAt)}</span>
            </div>
            <h3 className="text-fg font-medium truncate group-hover:text-fg">{pr.title}</h3>
            <div className="mt-2 flex items-center gap-2 flex-wrap">
              <span className="chip-mono text-[11px]">{pr.headBranch}</span>
              {pr.hasReport ? <StatusBadge kind="report">has report</StatusBadge> : null}
            </div>
          </div>
          <div className="shrink-0 flex flex-col items-end gap-2">
            {badge}
            <span className="text-[11px] text-accent opacity-0 group-hover:opacity-100 transition-opacity">
              open →
            </span>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
