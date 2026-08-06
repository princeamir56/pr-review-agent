import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { T } from "../lib/motion";

export function EmptyState({
  title,
  hint,
  action
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}): JSX.Element {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={T.soft}
      className="card p-10 text-center"
    >
      <div className="text-fg font-medium">{title}</div>
      {hint ? <div className="text-fg-subtle text-sm mt-1">{hint}</div> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </motion.div>
  );
}
