import { existsSync } from "node:fs";
import * as path from "node:path";

/**
 * Walk up from this module until we hit the directory containing
 * `mcp-server/package.json` — pr-review-agent's own root. Same marker walk as
 * `getAgentRoot()` in github/githubClient.ts: anchoring on a real file survives
 * whichever depth the build emits into (`mcp-server/dist/`, or the web server's
 * `web/server/dist/mcp-server/src/`), unlike fixed `..` arithmetic.
 */
function findAgentRoot(): string | null {
  try {
    let dir = __dirname;
    for (;;) {
      if (existsSync(path.join(dir, "mcp-server", "package.json"))) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) {
        return null;
      }
      dir = parent;
    }
  } catch {
    return null;
  }
}

/**
 * Loads environment variables from a local `.env` file using Node's built-in
 * loader (Node >= 20.12 / 22). Both candidates are anchored on pr-review-agent's
 * own root — never the host repo's, which `process.cwd()` would resolve to once
 * pr-review-agent is cloned as a subfolder of another project. `web/server/.env`
 * is checked first so the web dashboard's own file keeps taking precedence over
 * the repo-root one, as `web/server/.env.example` documents. Real environment
 * variables always win: `loadEnvFile` does not overwrite already-set vars.
 * Missing files and older Node versions are tolerated silently so CI (which
 * injects env vars directly) is unaffected.
 */
export function loadEnv(): void {
  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loadEnvFile !== "function") {
    return;
  }

  const agentRoot = findAgentRoot();
  const candidates = agentRoot
    ? [path.join(agentRoot, "web", "server", ".env"), path.join(agentRoot, ".env")]
    : [];

  for (const file of candidates) {
    try {
      loadEnvFile(file);
      return;
    } catch {
      // File not found or unreadable — try the next candidate.
    }
  }
}
