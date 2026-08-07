import { existsSync } from "node:fs";
import * as path from "node:path";
import { findHostRepoRoot, GitHubClient } from "../../../mcp-server/src/github/githubClient";
import { loadEnv } from "../../../mcp-server/src/loadEnv";
import { ToolContext } from "../../../mcp-server/src/tools/types";

loadEnv();

/**
 * The directory `docs/pr-reviews/` should live under. Same precedence the CLI
 * uses (see mcp-server/src/cli.ts): `PR_AGENT_CWD` wins; otherwise, if
 * pr-review-agent is cloned inside another git repo, use that host repo's
 * root so the web dashboard sees the same reports the CLI wrote. Falls back to
 * pr-review-agent's own directory in the standalone case.
 */
export function repoRoot(): string {
  const override = process.env.PR_AGENT_CWD?.trim();
  if (override) {
    return override;
  }
  const agentRoot = findAgentRoot();
  // findHostRepoRoot only walks above pr-review-agent when its argument is
  // *inside* pr-review-agent's tree, so pass the agent root itself.
  const host = findHostRepoRoot(agentRoot);
  return host ?? agentRoot;
}

/**
 * Walk up from this compiled module until we hit the directory that contains
 * `mcp-server/package.json` — that's pr-review-agent's root. Anchoring on a
 * real file survives whichever depth `tsc` emits into `dist/`.
 */
export function findAgentRoot(): string {
  let dir = __dirname;
  for (;;) {
    if (existsSync(path.join(dir, "mcp-server", "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      // Shouldn't happen in a normal checkout; fall back to old behavior so we
      // at least keep serving something rather than crashing on import.
      return path.resolve(__dirname, "..", "..", "..");
    }
    dir = parent;
  }
}

/** Build a fresh ToolContext for a request. GitHubClient throws if GITHUB_TOKEN is missing. */
export function buildContext(): ToolContext {
  return {
    github: new GitHubClient(),
    cwd: repoRoot()
  };
}
