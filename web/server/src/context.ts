import * as path from "node:path";
import { GitHubClient } from "../../../mcp-server/src/github/githubClient";
import { loadEnv } from "../../../mcp-server/src/loadEnv";
import { ToolContext } from "../../../mcp-server/src/tools/types";

loadEnv();

/** Path of the pr-review-agent repo root, used so docs/pr-reviews/ writes land in the expected place. */
export function repoRoot(): string {
  return path.resolve(__dirname, "..", "..", "..");
}

/** Build a fresh ToolContext for a request. GitHubClient throws if GITHUB_TOKEN is missing. */
export function buildContext(): ToolContext {
  return {
    github: new GitHubClient(),
    cwd: repoRoot()
  };
}
