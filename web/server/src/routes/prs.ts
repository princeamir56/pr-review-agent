import { Router, Request, Response } from "express";
import { Octokit } from "@octokit/rest";
import { buildContext } from "../context";
import { resolveRepository } from "../../../../mcp-server/src/tools/types";
import { buildPRContext, findLatestReviewDoc } from "../../../../mcp-server/src/orchestrator";
import { formatError } from "../../../../mcp-server/src/github/githubClient";

export const prsRouter = Router();

/** Sanitize an optional owner/repo pair from query. Only [\w.-]+ allowed. */
function readRepoOverride(req: Request): { owner?: string; repo?: string } {
  const owner = typeof req.query.owner === "string" ? req.query.owner : undefined;
  const repo = typeof req.query.repo === "string" ? req.query.repo : undefined;
  const safe = /^[\w.-]{1,100}$/;
  return {
    owner: owner && safe.test(owner) ? owner : undefined,
    repo: repo && safe.test(repo) ? repo : undefined
  };
}

function parsePrNumber(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isInteger(n) && n > 0 && n < 10_000_000 ? n : null;
}

prsRouter.get("/repo", async (req: Request, res: Response) => {
  try {
    const context = buildContext();
    const override = readRepoOverride(req);
    const repo = await resolveRepository(override, context);
    res.json({ ok: true, ...repo });
  } catch (error) {
    res.status(400).json({ ok: false, error: formatError(error) });
  }
});

prsRouter.get("/open", async (req: Request, res: Response) => {
  try {
    const context = buildContext();
    const { owner, repo } = await resolveRepository(readRepoOverride(req), context);
    const list = await context.github.listOpenPullRequests(owner, repo);
    const enriched = await Promise.all(
      list.map(async (pr) => {
        const doc = await findLatestReviewDoc(context.cwd, pr.number);
        return { ...pr, hasReport: Boolean(doc), reportPath: doc ?? null };
      })
    );
    res.json({ ok: true, owner, repo, prs: enriched });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

/**
 * Closed PRs — not exposed by GitHubClient today, so we call Octokit directly here.
 * Kept in the web layer to avoid mutating mcp-server per the spec.
 */
prsRouter.get("/closed", async (req: Request, res: Response) => {
  try {
    const token = process.env.GITHUB_TOKEN;
    if (!token) throw new Error("GITHUB_TOKEN not set");
    const context = buildContext();
    const { owner, repo } = await resolveRepository(readRepoOverride(req), context);
    const octokit = new Octokit({ auth: token, userAgent: "pr-review-agent-web/0.1.0" });
    const { data } = await octokit.pulls.list({
      owner,
      repo,
      state: "closed",
      sort: "updated",
      direction: "desc",
      per_page: 50
    });
    const prs = await Promise.all(
      data.map(async (p) => {
        const doc = await findLatestReviewDoc(context.cwd, p.number);
        return {
          number: p.number,
          title: p.title,
          author: p.user?.login ?? "unknown",
          createdAt: p.created_at,
          closedAt: p.closed_at,
          merged: Boolean(p.merged_at),
          headBranch: p.head.ref,
          changedFiles: null as number | null,
          hasReport: Boolean(doc),
          reportPath: doc ?? null
        };
      })
    );
    res.json({ ok: true, owner, repo, prs });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

prsRouter.get("/:prNumber", async (req: Request, res: Response) => {
  const prNumber = parsePrNumber(req.params.prNumber);
  if (!prNumber) {
    res.status(400).json({ ok: false, error: "Invalid PR number." });
    return;
  }
  try {
    const context = buildContext();
    const { owner, repo } = await resolveRepository(readRepoOverride(req), context);
    const prContext = await buildPRContext(context, owner, repo, prNumber);
    const doc = await findLatestReviewDoc(context.cwd, prNumber);
    res.json({
      ok: true,
      pr: {
        owner,
        repo,
        number: prContext.prNumber,
        title: prContext.title,
        body: prContext.body,
        author: prContext.author,
        baseBranch: prContext.baseBranch,
        headBranch: prContext.headBranch,
        headSha: prContext.headSha,
        htmlUrl: prContext.htmlUrl,
        commits: prContext.commits,
        files: prContext.files.map((f) => ({
          filename: f.filename,
          status: f.status,
          additions: f.additions,
          deletions: f.deletions,
          changes: f.changes,
          patch: f.patch
        }))
      },
      report: { hasReport: Boolean(doc), reportPath: doc ?? null }
    });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

prsRouter.get("/:prNumber/status", async (req: Request, res: Response) => {
  const prNumber = parsePrNumber(req.params.prNumber);
  if (!prNumber) {
    res.status(400).json({ ok: false, error: "Invalid PR number." });
    return;
  }
  try {
    const context = buildContext();
    const doc = await findLatestReviewDoc(context.cwd, prNumber);
    res.json({ ok: true, prNumber, hasReport: Boolean(doc), reportPath: doc ?? null });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});
