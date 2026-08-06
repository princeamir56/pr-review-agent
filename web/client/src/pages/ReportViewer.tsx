import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import rehypeSlug from "rehype-slug";
import { api } from "../lib/api";
import { EmptyState } from "../components/EmptyState";
import { SeverityBreakdown } from "../components/SeverityBreakdown";
import { parseSeverityLine, extractToc, cn } from "../lib/utils";
import { T } from "../lib/motion";

export function ReportViewer(): JSX.Element {
  const { name } = useParams<{ name: string }>();
  const list = useQuery({ queryKey: ["reports"], queryFn: api.listReports });

  if (!name) {
    return (
      <div className="space-y-6">
        <div>
          <div className="telemetry text-fg-subtle mb-2">REPORTS</div>
          <h1 className="font-display text-3xl font-semibold tracking-tightest text-fg">All reviews</h1>
          <p className="text-sm text-fg-muted mt-1">Every file written to <code className="font-mono">docs/pr-reviews/</code>.</p>
        </div>
        {list.isLoading ? (
          <div className="card p-8"><div className="skeleton h-6 w-1/2 mb-3" /><div className="skeleton h-4 w-1/3" /></div>
        ) : list.data && list.data.reports.length ? (
          <div className="grid gap-2">
            {list.data.reports.map((r, i) => (
              <motion.div
                key={r.name}
                initial={{ opacity: 0, y: 4 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ ...T.soft, delay: i * 0.02 }}
              >
                <Link to={`/reports/${encodeURIComponent(r.name)}`} className="card p-3 flex items-center justify-between hover:border-line-strong hover:bg-bg-2/60 transition-colors">
                  <div>
                    <div className="text-fg font-medium font-mono text-sm">{r.name}</div>
                    <div className="text-xs text-fg-subtle mt-0.5">PR #{r.prNumber} · {r.date}</div>
                  </div>
                  <span className="text-xs text-fg-subtle font-mono">{Math.round(r.size / 1024)} KB</span>
                </Link>
              </motion.div>
            ))}
          </div>
        ) : (
          <EmptyState title="No reports yet" hint="Run a review from any PR to generate one." />
        )}
      </div>
    );
  }

  return <SingleReport name={name} />;
}

function SingleReport({ name }: { name: string }): JSX.Element {
  const q = useQuery({ queryKey: ["report", name], queryFn: () => api.getReport(name) });
  const [activeSlug, setActiveSlug] = useState<string | null>(null);

  const toc = useMemo(() => (q.data ? extractToc(q.data.content) : []), [q.data]);
  const breakdown = q.data ? parseSeverityLine(q.data.content) : null;

  useEffect(() => {
    if (!q.data) return;
    const headings = Array.from(document.querySelectorAll<HTMLElement>("main h2[id], main h3[id]"));
    if (!headings.length) return;
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            setActiveSlug(entry.target.id);
            break;
          }
        }
      },
      { rootMargin: "-72px 0px -60% 0px", threshold: [0, 1] }
    );
    headings.forEach((h) => observer.observe(h));
    return () => observer.disconnect();
  }, [q.data]);

  if (q.isLoading) return <div className="card p-8"><div className="skeleton h-6 w-1/2 mb-3" /><div className="skeleton h-4 w-1/3" /></div>;
  if (q.error || !q.data) return <EmptyState title="Report not found" hint={(q.error as Error | undefined)?.message} action={<Link className="btn" to="/reports">← All reports</Link>} />;

  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_240px] gap-6">
      <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.soft} className="card p-6 min-w-0">
        <div className="mb-3 flex items-center gap-2 text-xs text-fg-subtle">
          <Link to="/reports" className="hover:text-fg-muted">← All reports</Link>
          <span>·</span>
          <span className="font-mono text-fg-muted">{q.data.name}</span>
        </div>
        <div className="markdown">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            rehypePlugins={[rehypeSlug, rehypeHighlight]}
          >
            {q.data.content}
          </ReactMarkdown>
        </div>
      </motion.div>
      <aside className="lg:sticky lg:top-[76px] lg:self-start space-y-4">
        {breakdown ? <SeverityBreakdown breakdown={breakdown} /> : null}
        {toc.length ? (
          <nav className="card p-4">
            <div className="telemetry text-fg-subtle mb-3">ON.THIS.PAGE</div>
            <ul className="space-y-1 text-sm">
              {toc.map((h) => (
                <li key={h.slug} className={cn(h.level === 3 && "pl-3")}>
                  <a
                    href={`#${h.slug}`}
                    className={cn(
                      "block truncate py-1 border-l-2 pl-2 -ml-2 transition-colors",
                      activeSlug === h.slug
                        ? "border-accent text-fg"
                        : "border-transparent text-fg-muted hover:text-fg"
                    )}
                  >
                    {h.text}
                  </a>
                </li>
              ))}
            </ul>
          </nav>
        ) : null}
      </aside>
    </div>
  );
}
