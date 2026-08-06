import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import { api } from "../lib/api";
import { PRCard } from "../components/PRCard";
import { PRCardSkeleton } from "../components/Skeleton";
import { EmptyState } from "../components/EmptyState";
import { CountUp } from "../components/CountUp";
import { cn, formatRelative } from "../lib/utils";
import { T, stagger } from "../lib/motion";

type Tab = "open" | "closed";
type Filter = "all" | "with-report" | "without-report";

const TABS: Tab[] = ["open", "closed"];
const FILTERS: { id: Filter; label: string }[] = [
  { id: "all", label: "All" },
  { id: "with-report", label: "Reviewed" },
  { id: "without-report", label: "New" }
];

export function Dashboard(): JSX.Element {
  const [tab, setTab] = useState<Tab>("open");
  const [q, setQ] = useState("");
  const [filter, setFilter] = useState<Filter>("all");

  const open = useQuery({ queryKey: ["prs", "open"], queryFn: api.listOpen });
  const closed = useQuery({ queryKey: ["prs", "closed"], queryFn: api.listClosed, enabled: tab === "closed" });
  const reports = useQuery({ queryKey: ["reports"], queryFn: api.listReports });

  const data = tab === "open" ? open : closed;
  const items = (data.data?.prs ?? []).filter((pr) => {
    if (filter === "with-report" && !pr.hasReport) return false;
    if (filter === "without-report" && pr.hasReport) return false;
    if (!q) return true;
    const hay = `${pr.number} ${pr.title} ${pr.author} ${pr.headBranch}`.toLowerCase();
    return hay.includes(q.toLowerCase());
  });

  const stats = useMemo(() => {
    const src = data.data?.prs ?? [];
    return { total: src.length, withReport: src.filter((p) => p.hasReport).length };
  }, [data.data]);

  const lastReview = reports.data?.reports[0];

  return (
    <div className="space-y-8">
      <section className="hero-glow hero-grid relative pt-2 pb-6">
        <div className="flex items-end justify-between flex-wrap gap-6">
          <div className="min-w-0">
            <div className="telemetry text-fg-subtle mb-3">DASHBOARD · {open.data ? `${open.data.owner}/${open.data.repo}` : "…"}</div>
            <h1 className="font-display text-4xl md:text-5xl font-semibold tracking-tightest leading-[1.05] text-fg">
              Review pull<br />requests, live.
            </h1>
            <p className="text-fg-muted text-sm mt-3 max-w-xl">
              Three deterministic agents in parallel — summary, security, docs — writing to <code className="font-mono text-fg">docs/pr-reviews/</code> and back to GitHub.
            </p>
          </div>
          <motion.div initial="initial" animate="animate" variants={stagger(0.05)} className="flex gap-3">
            <motion.div variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }} transition={T.soft}>
              <StatTile label="Open" value={open.data?.prs.length ?? 0} loading={open.isLoading} />
            </motion.div>
            <motion.div variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }} transition={T.soft}>
              <StatTile label="Reviewed" value={stats.withReport} accent loading={data.isLoading} />
            </motion.div>
            <motion.div variants={{ initial: { opacity: 0, y: 8 }, animate: { opacity: 1, y: 0 } }} transition={T.soft}>
              <StatTile
                label="Last review"
                text={lastReview ? formatRelative(lastReview.modifiedAt) : "—"}
                loading={reports.isLoading}
              />
            </motion.div>
          </motion.div>
        </div>
      </section>

      <div className="card-quiet p-2 flex flex-wrap items-center gap-2">
        <div className="relative flex bg-bg-2 rounded-lg p-1">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                "relative px-3.5 py-1.5 rounded-md text-sm font-medium capitalize transition-colors",
                tab === t ? "text-fg" : "text-fg-muted hover:text-fg"
              )}
            >
              {tab === t ? (
                <motion.span layoutId="tab-pill" transition={T.spring} className="absolute inset-0 rounded-md bg-bg-0 shadow-[0_1px_0_rgb(var(--line-strong))]" />
              ) : null}
              <span className="relative z-10">{t}</span>
            </button>
          ))}
        </div>

        <div className="flex bg-bg-2 rounded-lg p-1">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              onClick={() => setFilter(f.id)}
              className={cn(
                "relative px-3 py-1.5 rounded-md text-xs font-medium transition-colors telemetry",
                filter === f.id ? "text-fg" : "text-fg-subtle hover:text-fg-muted"
              )}
            >
              {filter === f.id ? (
                <motion.span layoutId="filter-pill" transition={T.spring} className="absolute inset-0 rounded-md bg-accent/15 border border-accent/30" />
              ) : null}
              <span className="relative z-10">{f.label}</span>
            </button>
          ))}
        </div>

        <div className="flex-1 min-w-[240px] px-1">
          <input
            className="input"
            placeholder="Search #, title, author, branch…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
          />
        </div>
        <button className="btn btn-ghost text-sm" onClick={() => data.refetch()}>↻ Refresh</button>
      </div>

      {data.isLoading ? (
        <div className="grid gap-3">
          {[...Array(4)].map((_, i) => <PRCardSkeleton key={i} />)}
        </div>
      ) : data.error ? (
        <EmptyState
          title="Couldn't load pull requests"
          hint={(data.error as Error).message}
          action={<button className="btn" onClick={() => data.refetch()}>Try again</button>}
        />
      ) : items.length === 0 ? (
        <EmptyState title="No pull requests match your filters" hint="Try clearing the search or switching tabs." />
      ) : (
        <motion.div
          layout
          variants={stagger(0.04)}
          initial="initial"
          animate="animate"
          className="grid gap-3"
        >
          <AnimatePresence>
            {items.map((pr) => (
              <PRCard key={`${tab}-${pr.number}`} pr={pr} kind={tab} />
            ))}
          </AnimatePresence>
        </motion.div>
      )}
    </div>
  );
}

function StatTile({
  label,
  value,
  text,
  accent,
  loading
}: {
  label: string;
  value?: number;
  text?: string;
  accent?: boolean;
  loading?: boolean;
}): JSX.Element {
  return (
    <div className={cn("card px-4 py-3 min-w-[120px]", accent && "border-accent/40 bg-accent/5")}>
      <div className="telemetry text-fg-subtle">{label}</div>
      <div className="mt-1 font-display text-2xl font-semibold tabular-nums text-fg tracking-tightest">
        {loading ? "…" : text ?? (typeof value === "number" ? <CountUp value={value} /> : "—")}
      </div>
    </div>
  );
}
