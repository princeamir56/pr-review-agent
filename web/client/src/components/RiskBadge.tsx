import { motion } from "framer-motion";
import type { RiskLevel } from "../lib/api";
import { RISK_TONE, cn } from "../lib/utils";
import { T } from "../lib/motion";

export function RiskBadge({ level }: { level: RiskLevel | null | undefined }): JSX.Element {
  const l = (level ?? "clean") as RiskLevel;
  return (
    <motion.span
      initial={{ opacity: 0, scale: 0.9 }}
      animate={{ opacity: 1, scale: 1 }}
      transition={T.soft}
      className={cn("chip border telemetry", RISK_TONE[l])}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-80" />
      {l}
    </motion.span>
  );
}
