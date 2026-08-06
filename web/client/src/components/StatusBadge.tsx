import { cn } from "../lib/utils";

export function StatusBadge({
  kind,
  children
}: {
  kind: "open" | "merged" | "closed" | "report";
  children: React.ReactNode;
}): JSX.Element {
  return (
    <span
      className={cn(
        "chip border telemetry",
        kind === "open" && "text-sev-clean bg-sev-clean/10 border-sev-clean/30",
        kind === "merged" && "text-accent bg-accent/10 border-accent/30",
        kind === "closed" && "text-fg-subtle bg-bg-2 border-line",
        kind === "report" && "text-sev-medium bg-sev-medium/10 border-sev-medium/30"
      )}
    >
      {children}
    </span>
  );
}
