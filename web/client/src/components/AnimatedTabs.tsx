import { motion } from "framer-motion";
import { T } from "../lib/motion";
import { cn } from "../lib/utils";

interface Item { id: string; label: string }

export function AnimatedTabs<T extends Item>({
  items,
  active,
  onChange,
  layoutId = "tabs-underline"
}: {
  items: T[];
  active: string;
  onChange(id: string): void;
  layoutId?: string;
}): JSX.Element {
  return (
    <div className="flex items-center gap-1 border-b border-line">
      {items.map((it) => {
        const isActive = it.id === active;
        return (
          <button
            key={it.id}
            onClick={() => onChange(it.id)}
            className={cn(
              "relative px-3 py-2 text-sm font-medium transition-colors",
              isActive ? "text-fg" : "text-fg-muted hover:text-fg"
            )}
          >
            <span className="relative z-10">{it.label}</span>
            {isActive ? (
              <motion.span
                layoutId={layoutId}
                transition={T.spring}
                className="absolute inset-x-2 -bottom-[1px] h-[2px] rounded-full bg-accent shadow-[0_0_10px_rgb(var(--accent)/0.7)]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
