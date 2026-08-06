import { Router, Request, Response } from "express";
import { promises as fs } from "node:fs";
import * as path from "node:path";
import { repoRoot } from "../context";
import { formatError } from "../../../../mcp-server/src/github/githubClient";

export const reportsRouter = Router();

const REPORTS_DIR = path.join(repoRoot(), "docs", "pr-reviews");

function safeName(name: string): boolean {
  return /^PR-\d+-\d{4}-\d{2}-\d{2}\.md$/.test(name);
}

reportsRouter.get("/", async (_req: Request, res: Response) => {
  try {
    let entries: string[];
    try {
      entries = await fs.readdir(REPORTS_DIR);
    } catch {
      entries = [];
    }
    const reports = await Promise.all(
      entries
        .filter(safeName)
        .sort()
        .reverse()
        .map(async (name) => {
          const full = path.join(REPORTS_DIR, name);
          const stat = await fs.stat(full);
          const match = /^PR-(\d+)-(\d{4}-\d{2}-\d{2})\.md$/.exec(name);
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
    const full = path.join(REPORTS_DIR, name);
    const content = await fs.readFile(full, "utf8");
    res.json({ ok: true, name, content });
  } catch (error) {
    res.status(404).json({ ok: false, error: formatError(error) });
  }
});
