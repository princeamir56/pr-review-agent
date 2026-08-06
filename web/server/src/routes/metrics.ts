import { Router, Request, Response } from "express";
import { buildContext } from "../context";
import { readRuns, summarizeRuns } from "../../../../mcp-server/src/agents/runStore";
import { formatError } from "../../../../mcp-server/src/github/githubClient";

export const metricsRouter = Router();

/** Aggregate trends across every recorded review. */
metricsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    const context = buildContext();
    const runs = await readRuns(context.cwd);
    res.json({ ok: true, trends: summarizeRuns(runs) });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

/**
 * The most recent runs, newest first — the raw rows behind the trends. Capped so
 * a long-lived store can't return megabytes to the browser.
 */
metricsRouter.get("/runs", async (req: Request, res: Response) => {
  try {
    const parsed = Number.parseInt(String(req.query.limit ?? "50"), 10);
    const limit = Number.isInteger(parsed) ? Math.min(Math.max(parsed, 1), 500) : 50;

    const context = buildContext();
    const runs = await readRuns(context.cwd);
    res.json({ ok: true, runs: runs.slice(-limit).reverse(), total: runs.length });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});
