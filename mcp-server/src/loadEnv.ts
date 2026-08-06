import * as path from "node:path";

/**
 * Loads environment variables from a local `.env` file using Node's built-in
 * loader (Node >= 20.12 / 22). Looks for `.env` in the current working directory
 * first, then in the repository root one level above `mcp-server/`. Missing files
 * and older Node versions are tolerated silently so CI (which injects env vars
 * directly) is unaffected.
 */
export function loadEnv(): void {
  const loadEnvFile = (process as NodeJS.Process & { loadEnvFile?: (p?: string) => void }).loadEnvFile;
  if (typeof loadEnvFile !== "function") {
    return;
  }

  const candidates = [
    path.join(process.cwd(), ".env"),
    path.join(__dirname, "..", "..", ".env")
  ];

  for (const file of candidates) {
    try {
      loadEnvFile(file);
      return;
    } catch {
      // File not found or unreadable — try the next candidate.
    }
  }
}
