import { Router, Request, Response } from "express";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { repoRoot } from "../context";
import { formatError } from "../../../../mcp-server/src/github/githubClient";

export const reportsRouter = Router();

/**
 * Resolved per request, not at module load: `repoRoot()` depends on
 * `PR_AGENT_CWD`, which `applyToProcessEnv` may set *after* this module is
 * imported. Caching it at import time pinned the dashboard to whatever the
 * environment looked like during startup.
 */
function reportsDir(): string {
  return path.join(repoRoot(), "docs", "pr-reviews");
}

/**
 * Accepts both report filenames the orchestrator produces: the current
 * `PR-<n>-<date>-<sha>.md` and the older `PR-<n>-<date>.md`. The pattern is also
 * the path-traversal guard, so it stays anchored and character-restricted —
 * the SHA segment is hex only.
 */
function safeName(name: string): boolean {
  return /^PR-\d+-\d{4}-\d{2}-\d{2}(-[0-9a-f]{7,40})?\.md$/.test(name);
}

reportsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    let entries: string[];
    try {
      entries = await fs.readdir(reportsDir());
    } catch {
      entries = [];
    }
    const reports = await Promise.all(
      entries
        .filter(safeName)
        .sort()
        .reverse()
        .map(async (name) => {
          const full = path.join(reportsDir(), name);
          const stat = await fs.stat(full);
          // Must tolerate the optional -<sha> segment, or prNumber/date come
          // back null for every report the current orchestrator writes.
          const match = /^PR-(\d+)-(\d{4}-\d{2}-\d{2})(?:-[0-9a-f]{7,40})?\.md$/.exec(name);
          return {
            name,
            prNumber: match ? Number(match[1]) : null,
            date: match ? match[2] : null,
            size: stat.size,
            modifiedAt: stat.mtime.toISOString()
          };
        })
    );
    res.json({ ok: true, reports });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

reportsRouter.get("/:name", async (req: Request, res: Response) => {
  const name = req.params.name ?? "";
  if (!safeName(name)) {
    res.status(400).json({ ok: false, error: "Invalid report name." });
    return;
  }
  try {
    const full = path.join(reportsDir(), name);
    const content = await fs.readFile(full, "utf8");
    res.json({ ok: true, name, content });
  } catch (error) {
    res.status(404).json({ ok: false, error: formatError(error) });
  }
});
