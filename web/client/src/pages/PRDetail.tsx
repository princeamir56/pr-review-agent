import { useEffect, useMemo, useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AnimatePresence, motion } from "framer-motion";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";
import { api, type AgentName } from "../lib/api";
import { useReviewStream } from "../lib/realtime";
import { AgentSelectionPanel, AGENTS } from "../components/AgentSelectionPanel";
import { ActionsPanel } from "../components/ActionsPanel";
import { SeverityBreakdown } from "../components/SeverityBreakdown";
import { RiskBadge } from "../components/RiskBadge";
import { EmptyState } from "../components/EmptyState";
import { Avatar } from "../components/Avatar";
import { AnimatedTabs } from "../components/AnimatedTabs";
import { useToast } from "../components/Toast";
import { parseSeverityLine, formatRelative } from "../lib/utils";
import { T } from "../lib/motion";

type Section = "summary" | "security" | "documentation" | "decision" | "all";

const SECTION_HEADINGS: Record<Section, string | null> = {
  all: null,
  summary: "📋 Summary",
  security: "🔒 Security Analysis",
  documentation: "📚 Documentation",
  decision: "✅ Review Decision"
};

function extractSection(md: string, section: Section): string {
  const heading = SECTION_HEADINGS[section];
  if (!heading) return md;
  const idx = md.indexOf(`## ${heading}`);
  if (idx === -1) return `## ${heading}\n\n_Not present in this report._`;
  const rest = md.slice(idx);
  const next = rest.slice(3).search(/\n## /);
  return next === -1 ? rest : rest.slice(0, next + 3);
}

export function PRDetail(): JSX.Element {
  const { number } = useParams<{ number: string }>();
  const prNumber = Number(number);
  const toast = useToast();
  const qc = useQueryClient();
  const [postComment, setPostComment] = useState<boolean>(() => localStorage.getItem("post-comment") === "1");
  const [tab, setTab] = useState<Section>("all");
  const [selected, setSelected] = useState<AgentName[]>(AGENTS);
  useEffect(() => { localStorage.setItem("post-comment", postComment ? "1" : "0"); }, [postComment]);

  // Start each PR with all three agents armed.
  useEffect(() => { setSelected(AGENTS); }, [prNumber]);

  const toggleAgent = (a: AgentName): void =>
    setSelected((prev) => (prev.includes(a) ? prev.filter((x) => x !== a) : AGENTS.filter((x) => x === a || prev.includes(x))));

  const pr = useQuery({ queryKey: ["pr", prNumber], queryFn: () => api.getPr(prNumber), enabled: Number.isFinite(prNumber) });
  const { agents, connected } = useReviewStream(Number.isFinite(prNumber) ? prNumber : null);

  const [reportContent, setReportContent] = useState<string | null>(null);
  const reportPath = pr.data?.report.reportPath ?? null;

  useEffect(() => {
    setReportContent(null);
    if (reportPath) {
      const name = reportPath.split(/[\\/]/).pop() ?? "";
      api.getReport(name).then((r) => setReportContent(r.content)).catch(() => setReportContent(null));
    }
  }, [reportPath]);

  const runMutation = useMutation({
    mutationFn: (list: AgentName[]) => api.runReview(prNumber, list, postComment),
    onSuccess: async (res) => {
      toast.push("success", `Review complete — ${res.result.recommendation}`);
      await qc.invalidateQueries({ queryKey: ["pr", prNumber] });
      await qc.invalidateQueries({ queryKey: ["prs"] });
      const name = res.result.docPath.split(/[\\/]/).pop() ?? "";
      if (name) api.getReport(name).then((r) => setReportContent(r.content)).catch(() => undefined);
    },
    onError: (e: Error) => toast.push("error", e.message)
  });

  const postMutation = useMutation({
    mutationFn: () => api.postComment(prNumber),
    onSuccess: (r) => toast.push("success", `Comment posted → ${r.url}`),
    onError: (e: Error) => toast.push("error", e.message)
  });

  const running = runMutation.isPending;
  const breakdown = useMemo(() => (reportContent ? parseSeverityLine(reportContent) : null), [reportContent]);

  if (!Number.isFinite(prNumber)) return <EmptyState title="Invalid PR number" />;

  if (pr.isLoading) {
    return <div className="card p-6"><div className="skeleton h-6 w-1/2 mb-3" /><div className="skeleton h-4 w-1/3" /></div>;
  }
  if (pr.error) {
    return <EmptyState title="Failed to load PR" hint={(pr.error as Error).message} action={<Link className="btn" to="/dashboard">← Back</Link>} />;
  }
  if (!pr.data) return <EmptyState title="PR not found" />;

  const p = pr.data.pr;
  const total = p.files.reduce((s, f) => s + f.additions + f.deletions, 0);
  const shownMd = reportContent ? extractSection(reportContent, tab) : null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6">
      <div className="space-y-6 min-w-0">
        <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.soft} className="card p-6">
          <div className="flex items-center gap-2 text-xs text-fg-subtle mb-3">
            <Link to="/dashboard" className="hover:text-fg-muted">← All PRs</Link>
            <span>·</span>
            <a href={p.htmlUrl} target="_blank" rel="noreferrer" className="hover:text-fg-muted">Open on GitHub ↗</a>
          </div>
          <h1 className="font-display text-3xl font-semibold tracking-tightest text-fg leading-tight">
            <span className="text-fg-subtle font-mono mr-2 font-normal">#{p.number}</span>
            {p.title}
          </h1>
          <div className="mt-4 flex flex-wrap items-center gap-2 text-sm text-fg-muted">
            <Avatar name={p.author} size={22} />
            <span>@{p.author}</span>
            <span className="text-fg-subtle">·</span>
            <span className="chip-mono">{p.headBranch}</span>
            <span className="text-fg-subtle">→</span>
            <span className="chip-mono">{p.baseBranch}</span>
            <span className="text-fg-subtle">·</span>
            <span>{p.files.length} files · <span className="tabular-nums">{total}</span> lines changed</span>
          </div>
          {p.body ? (
            <div className="mt-5 markdown text-sm border-t border-line pt-4">
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{p.body}</ReactMarkdown>
            </div>
          ) : null}
        </motion.div>

        {reportContent ? (
          <motion.div initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} transition={T.soft} className="card overflow-hidden">
            <div className="px-6 pt-5">
              <div className="flex items-center justify-between mb-3">
                <h2 className="font-display text-lg font-semibold tracking-tightest text-fg">Review report</h2>
                {reportPath ? (
                  <Link to={`/reports/${encodeURIComponent(reportPath.split(/[\\/]/).pop() ?? "")}`} className="text-xs text-accent hover:underline">
                    Open standalone ↗
                  </Link>
                ) : null}
              </div>
              <AnimatedTabs
                items={[
                  { id: "all", label: "All" },
                  { id: "summary", label: "Summary" },
                  { id: "security", label: "Security" },
                  { id: "documentation", label: "Documentation" },
                  { id: "decision", label: "Decision" }
                ]}
                active={tab}
                onChange={(id) => setTab(id as Section)}
              />
            </div>
            <div className="px-6 pb-6 pt-4">
              <AnimatePresence mode="wait">
                <motion.div
                  key={tab}
                  initial={{ opacity: 0, y: 4 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -4 }}
                  transition={T.soft}
                  className="markdown"
                >
                  <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
                    {shownMd ?? ""}
                  </ReactMarkdown>
                </motion.div>
              </AnimatePresence>
            </div>
          </motion.div>
        ) : (
          <EmptyState title="No review yet" hint="Run a review to generate a report for this PR." />
        )}
      </div>

      {/* Sidebar is capped to the viewport and scrolls on its own, so Actions stays
          reachable no matter how long the report in the main column gets. */}
      <div
        className="space-y-4 lg:sticky lg:top-[76px] lg:self-start
                   lg:max-h-[calc(100vh-92px)] lg:overflow-y-auto lg:overscroll-contain
                   lg:px-1 lg:-mx-1 lg:py-1 lg:-my-1 sidebar-scroll"
      >
        <AgentSelectionPanel
          agents={agents}
          selected={selected}
          onToggle={toggleAgent}
          onSelectAll={() => setSelected(AGENTS)}
          active={running || connected}
          disabled={running}
        />

        {breakdown ? <SeverityBreakdown breakdown={breakdown} /> : null}

        <ActionsPanel
          selectedCount={selected.length}
          totalAgents={AGENTS.length}
          running={running}
          onRun={() => runMutation.mutate(selected)}
          postComment={postComment}
          onPostCommentChange={setPostComment}
          onPostReport={() => postMutation.mutate()}
          posting={postMutation.isPending}
          canPostReport={Boolean(reportPath)}
        />

        {runMutation.data ? (
          <motion.div initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} className="card p-4 text-sm">
            <div className="flex items-center justify-between">
              <span className="telemetry text-fg-subtle">LAST.RUN</span>
              <RiskBadge level={runMutation.data.result.riskLevel} />
            </div>
            <div className="mt-2 text-fg font-medium">{runMutation.data.result.recommendation}</div>
            <div className="mt-1 text-xs text-fg-subtle">{formatRelative(new Date().toISOString())}</div>
            {runMutation.data.result.commentUrl ? (
              <a className="text-xs text-accent hover:underline" href={runMutation.data.result.commentUrl} target="_blank" rel="noreferrer">
                View comment on GitHub ↗
              </a>
            ) : null}
          </motion.div>
        ) : null}
      </div>
    </div>
  );
}
