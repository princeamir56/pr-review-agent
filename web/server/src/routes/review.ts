import { Router, Request, Response } from "express";
import { promises as fs } from "node:fs";
import { buildContext } from "../context";
import { resolveRepository } from "../../../../mcp-server/src/tools/types";
import {
  AgentName,
  buildPRContext,
  findLatestReviewDoc,
  runReview
} from "../../../../mcp-server/src/orchestrator";
import { formatError } from "../../../../mcp-server/src/github/githubClient";
import { reviewBus } from "../sse";

export const reviewRouter = Router();

const ALL_AGENTS: AgentName[] = ["summary", "security", "documentation"];

function parsePrNumber(raw: unknown): number | null {
  const n = typeof raw === "string" ? Number.parseInt(raw, 10) : Number(raw);
  return Number.isInteger(n) && n > 0 && n < 10_000_000 ? n : null;
}

function parseAgents(raw: unknown): AgentName[] {
  if (!Array.isArray(raw)) return ALL_AGENTS;
  const set = new Set<AgentName>();
  for (const item of raw) {
    if (item === "summary" || item === "security" || item === "documentation") set.add(item);
  }
  return set.size ? [...set] : ALL_AGENTS;
}

reviewRouter.post("/:prNumber/run", async (req: Request, res: Response) => {
  const prNumber = parsePrNumber(req.params.prNumber);
  if (!prNumber) {
    res.status(400).json({ ok: false, error: "Invalid PR number." });
    return;
  }
  const agents = parseAgents(req.body?.agents);
  const postComment = req.body?.postComment === true;

  try {
    const context = buildContext();
    const { owner, repo } = await resolveRepository(req.body ?? {}, context);

    reviewBus.emitEvent({ type: "review", prNumber, state: "started" });
    for (const a of agents) reviewBus.emitEvent({ type: "agent", prNumber, agent: a, state: "pending" });

    const prContext = await buildPRContext(context, owner, repo, prNumber);

    // Per-agent progress comes from the orchestrator's own callbacks, so each
    // agent flips state when it actually starts and finishes rather than all
    // three flipping together around the Promise.all.
    const result = await runReview(context, prContext, {
      agents,
      postComment,
      onAgentStart: (agent) => reviewBus.emitEvent({ type: "agent", prNumber, agent, state: "running" }),
      onAgentDone: (envelope) =>
        reviewBus.emitEvent({
          type: "agent",
          prNumber,
          agent: envelope.agent,
          state: envelope.status === "error" ? "error" : "complete"
        })
    });

    reviewBus.emitEvent({
      type: "review",
      prNumber,
      state: "complete",
      docPath: result.docPath,
      commentUrl: result.commentUrl,
      recommendation: result.recommendation,
      riskLevel: result.riskLevel
    });

    res.json({
      ok: true,
      result: {
        prNumber: result.prNumber,
        title: result.title,
        owner: result.owner,
        repo: result.repo,
        riskLevel: result.riskLevel,
        recommendation: result.recommendation,
        docPath: result.docPath,
        commentUrl: result.commentUrl,
        commentUpdated: result.commentUpdated,
        inlineCommentCount: result.inlineCommentCount,
        durationMs: result.durationMs,
        envelopes: result.envelopes
      }
    });
  } catch (error) {
    reviewBus.emitEvent({ type: "review", prNumber, state: "error", message: formatError(error) });
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

reviewRouter.post("/:prNumber/postComment", async (req: Request, res: Response) => {
  const prNumber = parsePrNumber(req.params.prNumber);
  if (!prNumber) {
    res.status(400).json({ ok: false, error: "Invalid PR number." });
    return;
  }
  try {
    const context = buildContext();
    const { owner, repo } = await resolveRepository(req.body ?? {}, context);
    const doc = await findLatestReviewDoc(context.cwd, prNumber);
    if (!doc) {
      res.status(404).json({ ok: false, error: `No report found for PR #${prNumber}. Run a review first.` });
      return;
    }
    const body = await fs.readFile(doc, "utf8");
    const { url, updated } = await context.github.upsertIssueComment(owner, repo, prNumber, body);
    res.json({ ok: true, url, updated, reportPath: doc });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});
