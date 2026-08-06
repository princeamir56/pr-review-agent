#!/usr/bin/env node
/**
 * Command-line entry point backing the VS Code tasks (pr-agent.*). Lets the full
 * multi-agent pipeline run headlessly — from a task, an npm script, or CI — without
 * the MCP/chat layer. The working directory is the repository root, where
 * docs/pr-reviews/ lives; override with PR_AGENT_CWD if needed.
 */
import { execFile } from "node:child_process";
import { loadEnv } from "./loadEnv";
import { GitHubClient, findHostRepoRoot, formatError } from "./github/githubClient";

loadEnv();
import { ToolContext } from "./tools/types";
import { resolveRepository } from "./tools/types";
import { buildPRContext, runReview, findLatestReviewDoc, AgentName } from "./orchestrator";
import { promises as fs } from "node:fs";

type Command =
  | "reviewAll"
  | "reviewCurrent"
  | "summaryOnly"
  | "securityOnly"
  | "docsOnly"
  | "openLastReport"
  | "postComment";

const SINGLE_AGENT: Partial<Record<Command, AgentName>> = {
  summaryOnly: "summary",
  securityOnly: "security",
  docsOnly: "documentation"
};

async function main(): Promise<void> {
  const command = process.argv[2] as Command | undefined;
  const prArg = process.argv[3];
  const prNumber = prArg ? Number.parseInt(prArg, 10) : undefined;

  if (!command) {
    console.error("Usage: pr-agent <reviewAll|reviewCurrent|summaryOnly|securityOnly|docsOnly|openLastReport|postComment> [prNumber]");
    process.exit(1);
  }

  const cwd = process.env.PR_AGENT_CWD ?? resolveDefaultCwd();
  const context: ToolContext = { github: new GitHubClient(), cwd };

  switch (command) {
    case "reviewAll":
      await reviewAll(context);
      break;
    case "reviewCurrent":
      await reviewOne(context, await resolvePr(context, prNumber));
      break;
    case "summaryOnly":
    case "securityOnly":
    case "docsOnly":
      await reviewOne(context, await resolvePr(context, prNumber), SINGLE_AGENT[command]);
      break;
    case "openLastReport":
      await openLastReport(context, await resolvePr(context, prNumber));
      break;
    case "postComment":
      await postLastReport(context, await resolvePr(context, prNumber));
      break;
    default:
      console.error(`Unknown command: ${command}`);
      process.exit(1);
  }
}

/**
 * Default cwd when `PR_AGENT_CWD` is unset. Prefers the enclosing host repo
 * when pr-review-agent is cloned as a subfolder of another git repo, so
 * `docs/pr-reviews/` and git-remote detection both target the host — not the
 * agent's own directory. Falls back to `process.cwd()` in the standalone case.
 */
function resolveDefaultCwd(): string {
  const invoked = process.cwd();
  const host = findHostRepoRoot(invoked);
  return host ?? invoked;
}

async function resolvePr(context: ToolContext, prNumber?: number): Promise<{ owner: string; repo: string; prNumber: number }> {
  const repo = await resolveRepository({}, context);
  if (prNumber && Number.isFinite(prNumber)) {
    return { ...repo, prNumber };
  }
  const branch = await context.github.detectCurrentBranch(context.cwd);
  const detected = await context.github.detectOpenPullRequest(repo.owner, repo.repo, branch);
  return { ...repo, prNumber: detected };
}

async function reviewAll(context: ToolContext): Promise<void> {
  const repo = await resolveRepository({}, context);
  const prs = await context.github.listOpenPullRequests(repo.owner, repo.repo);
  if (prs.length === 0) {
    console.log(`No open pull requests found in ${repo.owner}/${repo.repo}.`);
    return;
  }
  console.log(`Reviewing ${prs.length} open PR(s) in ${repo.owner}/${repo.repo}...`);
  for (const pr of prs) {
    await reviewOne(context, { ...repo, prNumber: pr.number });
  }
}

async function reviewOne(
  context: ToolContext,
  pr: { owner: string; repo: string; prNumber: number },
  singleAgent?: AgentName
): Promise<void> {
  const prContext = await buildPRContext(context, pr.owner, pr.repo, pr.prNumber);
  const result = await runReview(context, prContext, {
    agents: singleAgent ? [singleAgent] : undefined,
    postComment: !singleAgent
  });

  console.log(`\n#${result.prNumber} ${result.title}`);
  console.log(`  risk: ${result.riskLevel} | recommendation: ${result.recommendation} | ${result.durationMs}ms`);
  console.log(`  doc: ${result.docPath}`);
  if (result.commentUrl) {
    console.log(`  comment (${result.commentUpdated ? "updated" : "created"}): ${result.commentUrl}`);
  }
  if (result.inlineCommentCount > 0) {
    console.log(`  inline: ${result.inlineCommentCount} finding(s) posted on the diff`);
  }
  if (singleAgent) {
    const envelope = result.envelopes.find((e) => e.agent === singleAgent);
    console.log("\n" + (envelope?.output_markdown ?? "(no output)"));
  }
}

async function openLastReport(context: ToolContext, pr: { prNumber: number }): Promise<void> {
  const docPath = await findLatestReviewDoc(context.cwd, pr.prNumber);
  if (!docPath) {
    console.log(`No review document found for PR #${pr.prNumber}. Run a review first.`);
    return;
  }
  console.log(docPath);
  execFile("code", [docPath], (error) => {
    if (error) {
      // `code` CLI not on PATH (e.g. CI) — printing the path is enough.
    }
  });
}

async function postLastReport(context: ToolContext, pr: { owner: string; repo: string; prNumber: number }): Promise<void> {
  const docPath = await findLatestReviewDoc(context.cwd, pr.prNumber);
  if (!docPath) {
    console.log(`No review document found for PR #${pr.prNumber}. Run a review first.`);
    return;
  }
  const body = await fs.readFile(docPath, "utf8");
  const { url, updated } = await context.github.upsertIssueComment(pr.owner, pr.repo, pr.prNumber, body);
  console.log(`${updated ? "Updated" : "Posted"} ${docPath} on ${pr.owner}/${pr.repo}#${pr.prNumber}: ${url}`);
}

main().catch((error: unknown) => {
  console.error(`pr-agent failed: ${formatError(error)}`);
  process.exit(1);
});
