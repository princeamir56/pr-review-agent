import { promises as fs } from "node:fs";
import * as path from "node:path";
import { InlineComment, formatError } from "./github/githubClient";
import { ToolContext } from "./tools/types";
import { AgentEnvelope, Finding, PRContext, RiskLevel, highestRisk } from "./agents/types";
import { runSummaryAgent } from "./agents/summaryAgent";
import { runSecurityAgent } from "./agents/securityAgent";
import { runDocumentationAgent } from "./agents/documentationAgent";
import { autoRunScanners } from "./agents/autoScan";
import { materializePrFiles } from "./agents/prSources";
import { LlmPassResult, renderLlmSection, runLlmPass } from "./agents/llmPass";
import { appendRun, buildRunRecord } from "./agents/runStore";

export type AgentName = "summary" | "security" | "documentation";

/** Severities that earn an inline comment on the diff. */
const INLINE_SEVERITIES = new Set(["critical", "high"]);

/** Cap on inline comments per review, so a bad PR can't bury the diff. */
const MAX_INLINE_COMMENTS = 20;

export interface ReviewOptions {
  /** Which agents to run. Defaults to all three. */
  agents?: AgentName[];
  /** When false, the merged comment is not posted to GitHub. Defaults to true. */
  postComment?: boolean;
  /**
   * When false, high/critical findings are not posted as inline review comments.
   * Defaults to true whenever the merged comment is posted.
   */
  inlineComments?: boolean;
  /**
   * Fired as each agent starts and finishes. Optional and synchronous — the
   * default is a no-op, so the CLI and CI paths behave exactly as before. The
   * web dashboard uses these to show per-agent state instead of flipping all
   * three at once.
   */
  onAgentStart?: (agent: AgentName) => void;
  onAgentDone?: (envelope: AgentEnvelope) => void;
}

export interface ReviewResult {
  prNumber: number;
  title: string;
  owner: string;
  repo: string;
  riskLevel: RiskLevel;
  recommendation: "APPROVE" | "REQUEST CHANGES" | "NEEDS DISCUSSION";
  envelopes: AgentEnvelope[];
  docPath: string;
  docMarkdown: string;
  commentUrl: string | null;
  /** True when the comment was edited in place rather than newly created. */
  commentUpdated: boolean;
  /** How many findings were posted as inline review comments. */
  inlineCommentCount: number;
  durationMs: number;
}

// The Security agent takes an extra `cwd` argument so it can locate SARIF files
// left by external scanners. Summary/Documentation ignore the second argument.
const AGENT_RUNNERS: Record<AgentName, (context: PRContext, cwd: string) => AgentEnvelope> = {
  summary: runSummaryAgent,
  security: runSecurityAgent,
  documentation: runDocumentationAgent
};

/**
 * Builds the shared PR context once (metadata + files/diff + commits) so all three
 * agents operate on the same data. Costs ~3 GitHub API calls regardless of agent count.
 */
export async function buildPRContext(context: ToolContext, owner: string, repo: string, prNumber: number): Promise<PRContext> {
  const [metadata, files] = await Promise.all([
    context.github.getPRMetadata(owner, repo, prNumber),
    context.github.getPRDiff(owner, repo, prNumber)
  ]);

  let commits: string[] = [];
  try {
    commits = await context.github.getCommits(owner, repo, metadata.headBranch);
  } catch {
    commits = [];
  }

  return {
    owner,
    repo,
    prNumber,
    title: metadata.title,
    body: metadata.body,
    author: metadata.author,
    baseBranch: metadata.baseBranch,
    headBranch: metadata.headBranch,
    headSha: metadata.headSha,
    htmlUrl: metadata.htmlUrl,
    files,
    commits
  };
}

/**
 * Runs the selected agents in parallel, merges their sections into the canonical
 * documentation file, writes it to docs/pr-reviews/, and optionally posts the merged
 * comment back to the PR. Partial agent failures are isolated: a failing agent yields
 * an error envelope and its section is marked failed rather than aborting the review.
 */
export async function runReview(context: ToolContext, prContext: PRContext, options: ReviewOptions = {}): Promise<ReviewResult> {
  const started = Date.now();
  const selected = options.agents ?? ["summary", "security", "documentation"];
  const shouldPost = options.postComment ?? true;
  const shouldComment = shouldPost && (options.inlineComments ?? true);

  // Auto-run the external scanners (Semgrep/Gitleaks/Trivy) before the Security
  // agent reads their SARIF. No-ops when the Security agent isn't selected, when
  // disabled (PR_AGENT_AUTO_SCAN=0), when Docker is absent, or when SARIF already
  // exists (e.g. CI ran them as explicit steps).
  if (selected.includes("security")) {
    // Fetch the PR's actual files (at head) over the API into a temp dir, so the
    // scanners work from any entry point regardless of the local checkout.
    const sources = await materializePrFiles(
      context.github,
      prContext.owner,
      prContext.repo,
      prContext.headSha,
      prContext.files,
      prContext.prNumber
    ).catch(() => null);
    try {
      await autoRunScanners(context.cwd, { scanDir: sources?.dir, prNumber: prContext.prNumber });
    } finally {
      sources?.cleanup();
    }
  }

  const envelopes = await Promise.all(
    selected.map(async (name) => {
      options.onAgentStart?.(name);
      const envelope = runAgentSafely(name, prContext, context.cwd);
      options.onAgentDone?.(envelope);
      return envelope;
    })
  );

  // Optional, flag-gated second opinion. Marks false positives on the envelope's
  // findings (so they are not posted inline) and contributes its own section.
  // Returns null whenever it is off or unavailable — every path below tolerates that.
  const securityFindings = envelopes.flatMap((envelope) => envelope.findings ?? []);
  const llm = await runLlmPass(prContext, securityFindings);

  const securityEnvelope = envelopes.find((e) => e.agent === "security");
  const docEnvelope = envelopes.find((e) => e.agent === "documentation");

  const riskLevel = highestRisk(envelopes.map((e) => e.risk_level));
  const recommendation = decideRecommendation(securityEnvelope, docEnvelope);

  const docMarkdown = mergeDocument(prContext, envelopes, riskLevel, recommendation, llm);
  const docPath = await writeDocument(context.cwd, prContext, docMarkdown);

  let commentUrl: string | null = null;
  let commentUpdated = false;
  let inlineCommentCount = 0;

  if (shouldPost) {
    const upserted = await context.github.upsertIssueComment(
      prContext.owner,
      prContext.repo,
      prContext.prNumber,
      docMarkdown
    );
    commentUrl = upserted.url;
    commentUpdated = upserted.updated;
  }

  if (shouldComment) {
    inlineCommentCount = await postInlineFindings(context, prContext, securityFindings);
  }

  const durationMs = Date.now() - started;

  await appendRun(
    context.cwd,
    buildRunRecord({
      owner: prContext.owner,
      repo: prContext.repo,
      prNumber: prContext.prNumber,
      headSha: prContext.headSha,
      riskLevel,
      recommendation,
      durationMs,
      filesChanged: prContext.files.length,
      envelopes
    })
  );

  return {
    prNumber: prContext.prNumber,
    title: prContext.title,
    owner: prContext.owner,
    repo: prContext.repo,
    riskLevel,
    recommendation,
    envelopes,
    docPath,
    docMarkdown,
    commentUrl,
    commentUpdated,
    inlineCommentCount,
    durationMs
  };
}

/**
 * Turn the worst findings into inline review comments on the lines that caused
 * them. Findings the LLM pass dismissed, and findings with no resolved line
 * (SARIF results scoped to a whole file, dependency-manifest notes), are skipped —
 * GitHub rejects a review whose comments don't sit on the diff.
 */
export function selectInlineComments(findings: Finding[]): InlineComment[] {
  const comments: InlineComment[] = [];
  const seen = new Set<string>();

  for (const finding of findings) {
    if (comments.length >= MAX_INLINE_COMMENTS) {
      break;
    }
    if (finding.dismissed || finding.line <= 0 || !INLINE_SEVERITIES.has(finding.severity)) {
      continue;
    }
    const key = `${finding.file}:${finding.line}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const cwe = finding.cwe ? ` [${finding.cwe}]` : "";
    comments.push({
      path: finding.file,
      line: finding.line,
      body: [
        `**${finding.severity.toUpperCase()} — ${finding.category}**${cwe}`,
        "",
        finding.issue,
        "",
        `*Recommendation:* ${finding.recommendation}`,
        "",
        "<sub>Posted by PR-Review-Agent. Suppress with `// pr-agent-ignore` on this line.</sub>"
      ].join("\n")
    });
  }

  return comments;
}

async function postInlineFindings(context: ToolContext, prContext: PRContext, findings: Finding[]): Promise<number> {
  const comments = selectInlineComments(findings);
  if (comments.length === 0) {
    return 0;
  }
  return context.github.createReviewWithComments(
    prContext.owner,
    prContext.repo,
    prContext.prNumber,
    prContext.headSha,
    comments
  );
}

function runAgentSafely(name: AgentName, prContext: PRContext, cwd: string): AgentEnvelope {
  try {
    return AGENT_RUNNERS[name](prContext, cwd);
  } catch (error) {
    return {
      agent: name,
      pr_number: prContext.prNumber,
      status: "error",
      risk_level: "clean",
      output_markdown: `## ${sectionTitle(name)}\n\n⚠️ **${name} agent failed:** ${formatError(error)}`,
      findings_count: 0,
      processing_time_ms: 0
    };
  }
}

function sectionTitle(name: AgentName): string {
  switch (name) {
    case "summary":
      return "📋 Summary";
    case "security":
      return "🔒 Security Analysis";
    case "documentation":
      return "📚 Documentation";
  }
}

function decideRecommendation(security?: AgentEnvelope, documentation?: AgentEnvelope): ReviewResult["recommendation"] {
  const risk = security?.risk_level ?? "clean";
  if (risk === "critical" || risk === "high") {
    return "REQUEST CHANGES";
  }
  if (risk === "medium" || (documentation && documentation.findings_count > 0)) {
    return "NEEDS DISCUSSION";
  }
  return "APPROVE";
}

export function mergeDocument(
  prContext: PRContext,
  envelopes: AgentEnvelope[],
  risk: RiskLevel,
  recommendation: string,
  llm: LlmPassResult | null = null,
  now: Date = new Date()
): string {
  const date = now.toISOString().slice(0, 10);
  const datetime = now.toISOString().replace("T", " ").slice(0, 19) + " UTC";

  const byAgent = (name: AgentName): AgentEnvelope | undefined => envelopes.find((e) => e.agent === name);
  const section = (name: AgentName, fallbackTitle: string): string =>
    byAgent(name)?.output_markdown ?? `## ${fallbackTitle}\n\n_Agent not run._`;

  const security = byAgent("security");
  const documentation = byAgent("documentation");

  const securityStatus = !security
    ? "— Skipped"
    : security.status === "error"
      ? "⚠️ Failed"
      : security.findings_count > 0
        ? "🔴 Issues found"
        : "🟢 Clean";
  const securityRisk = security ? riskLabel(security.risk_level) : "—";

  const docStatus = !documentation
    ? "— Skipped"
    : documentation.status === "error"
      ? "⚠️ Failed"
      : documentation.findings_count > 0
        ? "🟡 Updates needed"
        : "🟢 OK";

  const summaryStatus = byAgent("summary")
    ? byAgent("summary")?.status === "error" ? "⚠️ Failed" : "✅ Complete"
    : "— Skipped";

  return [
    `# PR Review — #${prContext.prNumber}: ${prContext.title}`,
    "",
    `**Repository**: ${prContext.owner}/${prContext.repo}`,
    `**Author**: @${prContext.author}`,
    `**Branch**: ${prContext.headBranch} → ${prContext.baseBranch}`,
    `**Date**: ${date}`,
    `**Reviewed by**: PR Review Agent (Orchestrator + 3 agents)`,
    "",
    "---",
    "",
    section("summary", "📋 Summary"),
    "",
    "---",
    "",
    section("security", "🔒 Security Analysis"),
    "",
    "---",
    "",
    section("documentation", "📚 Documentation"),
    ...(llm ? ["", "---", "", renderLlmSection(llm)] : []),
    "",
    "---",
    "",
    "## ✅ Review Decision",
    "",
    "| Agent | Status | Risk |",
    "|---|---|---|",
    `| Summary | ${summaryStatus} | — |`,
    `| Security | ${securityStatus} | ${securityRisk} |`,
    `| Documentation | ${docStatus} | ${documentation ? riskLabel(documentation.risk_level) : "—"} |`,
    "",
    `**Overall recommendation**: ${recommendation}`,
    "",
    "---",
    `*Generated by PR-Review-Agent on ${datetime}*`,
    ""
  ].join("\n");
}

function riskLabel(risk: RiskLevel): string {
  return risk.charAt(0).toUpperCase() + risk.slice(1);
}

/**
 * Filename for a review document. The head SHA is part of the name so two
 * reviews of the same PR on the same day no longer overwrite each other — the
 * directory becomes a per-commit history instead of a per-day snapshot.
 */
export function reviewDocName(prNumber: number, headSha: string, now: Date = new Date()): string {
  const date = now.toISOString().slice(0, 10);
  const sha = headSha.slice(0, 7);
  return sha ? `PR-${prNumber}-${date}-${sha}.md` : `PR-${prNumber}-${date}.md`;
}

async function writeDocument(cwd: string, prContext: PRContext, markdown: string): Promise<string> {
  const dir = path.join(cwd, "docs", "pr-reviews");
  await fs.mkdir(dir, { recursive: true });
  const filePath = path.join(dir, reviewDocName(prContext.prNumber, prContext.headSha));
  await fs.writeFile(filePath, markdown, "utf8");
  return filePath;
}

/**
 * Returns the path of the most recent review document for a PR, or null if none
 * exists. Matches both the current `PR-n-date-sha.md` form and the older
 * `PR-n-date.md` one, so reports written before the rename are still found.
 */
export async function findLatestReviewDoc(cwd: string, prNumber: number): Promise<string | null> {
  const dir = path.join(cwd, "docs", "pr-reviews");
  let entries: string[];
  try {
    entries = await fs.readdir(dir);
  } catch {
    return null;
  }
  const pattern = new RegExp(`^PR-${prNumber}-(\\d{4}-\\d{2}-\\d{2})(?:-[0-9a-f]+)?\\.md$`);
  const matches = entries
    .map((name) => ({ name, match: pattern.exec(name) }))
    .filter((entry): entry is { name: string; match: RegExpExecArray } => entry.match !== null)
    // Sort by date first, then by filename, so a same-day SHA variant is stable.
    .sort((a, b) => (a.match[1] ?? "").localeCompare(b.match[1] ?? "") || a.name.localeCompare(b.name));

  const last = matches[matches.length - 1];
  return last ? path.join(dir, last.name) : null;
}
