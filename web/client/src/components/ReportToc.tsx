import { motion, useReducedMotion } from "framer-motion";
import type { TocEntry } from "../lib/utils";
import { cn } from "../lib/utils";
import { T, stagger } from "../lib/motion";

/**
 * "On this page" nav for a report. The active section is tracked by the caller's
 * IntersectionObserver; a shared layoutId slides the accent rail between entries
 * as you scroll, instead of the border blinking on and off per item.
 */

export function ReportToc({
  items,
  activeSlug,
  onJump
}: {
  items: TocEntry[];
  activeSlug: string | null;
  onJump(slug: string): void;
}): JSX.Element {
  const reduced = useReducedMotion() ?? false;
  const activeIndex = items.findIndex((i) => i.slug === activeSlug);
  const progress = items.length > 1 && activeIndex >= 0 ? activeIndex / (items.length - 1) : 0;

  return (
    <nav aria-label="On this page" className="card p-4">
      <div className="flex items-center justify-between gap-2 mb-3">
        <div className="telemetry text-fg-subtle">ON.THIS.PAGE</div>
        <span className="text-[10px] font-mono text-fg-subtle tabular-nums">
          {activeIndex >= 0 ? activeIndex + 1 : "—"}/{items.length}
        </span>
      </div>

      <div className="relative">
        {/* Rail behind the items; the filled portion tracks reading progress. */}
        <span aria-hidden="true" className="absolute left-0 top-1 bottom-1 w-[2px] rounded-full bg-line" />
        <motion.span
          aria-hidden="true"
          className="absolute left-0 top-1 w-[2px] rounded-full bg-accent/40 origin-top"
          initial={false}
          animate={{ scaleY: progress }}
          style={{ height: "calc(100% - 8px)" }}
          transition={reduced ? { duration: 0 } : T.soft}
        />

        <motion.ul
          initial="initial"
          animate="animate"
          variants={stagger(0.04)}
          className="relative space-y-0.5"
        >
          {items.map((h) => {
            const active = h.slug === activeSlug;
            return (
              <motion.li
                key={h.slug}
                variants={{ initial: { opacity: 0, x: -4 }, animate: { opacity: 1, x: 0 } }}
                transition={T.soft}
                className={cn(h.level === 3 && "ml-3")}
              >
                <a
                  href={`#${h.slug}`}
                  aria-current={active ? "location" : undefined}
                  onClick={(e) => {
                    e.preventDefault();
                    onJump(h.slug);
                  }}
                  className={cn(
                    "group relative flex items-center gap-2 rounded-md py-1.5 pl-3 pr-2 text-sm transition-colors",
                    active ? "text-fg" : "text-fg-muted hover:text-fg hover:bg-bg-2"
                  )}
                >
                  {active ? (
                    <motion.span
                      layoutId="toc-active"
                      transition={reduced ? { duration: 0 } : T.spring}
                      className="absolute inset-0 rounded-md bg-accent/10 ring-1 ring-inset ring-accent/25"
                    />
                  ) : null}
                  {h.icon ? (
                    <span className="relative z-10 text-[13px] leading-none shrink-0">{h.icon}</span>
                  ) : (
                    <span
                      className={cn(
                        "relative z-10 w-1 h-1 rounded-full shrink-0 transition-colors",
                        active ? "bg-accent" : "bg-fg-subtle group-hover:bg-fg-muted"
                      )}
                    />
                  )}

                  <span className={cn("relative z-10 truncate", active && "font-medium")}>{h.text}</span>
                </a>
              </motion.li>
            );
          })}
        </motion.ul>
      </div>
    </nav>
  );
}
