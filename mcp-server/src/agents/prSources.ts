import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { ChangedFile, GitHubClient } from "../github/githubClient";

/** Cap on files fetched, so a huge PR can't hammer the API or blow up scan time. */
const MAX_FILES = 80;

export interface PrSources {
  /** Temp directory holding the PR's changed files at the head SHA. */
  dir: string;
  /** How many files were successfully written. */
  count: number;
  /** Remove the temp directory. Always call this when done. */
  cleanup: () => void;
}

/**
 * Materialize a PR's changed files (at its head commit) into a temporary directory,
 * fetched over the GitHub API — no local git clone required. The external scanners then
 * run against this directory, so their findings line up with the PR from ANY entry point
 * (web dashboard, VS Code extension, CLI), regardless of what branch is checked out
 * locally or whether the working directory is even the right repository.
 *
 * Returns null when there's nothing scannable (all files removed, or every fetch failed),
 * in which case the caller falls back to the regex engine only.
 */
export async function materializePrFiles(
  github: GitHubClient,
  owner: string,
  repo: string,
  headSha: string,
  files: ChangedFile[],
  prNumber: number
): Promise<PrSources | null> {
  const targets = files.filter((file) => file.status !== "removed").slice(0, MAX_FILES);
  if (targets.length === 0) {
    return null;
  }

  const dir = path.join(os.tmpdir(), `pr-agent-src-${prNumber}-${process.pid}`);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });

  let count = 0;
  for (const file of targets) {
    const rel = normalizeRel(file.filename);
    if (!rel) {
      continue;
    }
    const dest = path.join(dir, rel);
    if (!dest.startsWith(dir + path.sep)) {
      continue; // path-traversal guard
    }
    try {
      const content = await github.getFileContent(owner, repo, file.filename, headSha);
      mkdirSync(path.dirname(dest), { recursive: true });
      writeFileSync(dest, content, "utf8");
      count += 1;
    } catch {
      // Binary, too large, or vanished at head — skip; the others still scan.
    }
  }

  if (count === 0) {
    rmSync(dir, { recursive: true, force: true });
    return null;
  }

  return {
    dir,
    count,
    cleanup: () => rmSync(dir, { recursive: true, force: true })
  };
}

function normalizeRel(name: string): string | null {
  const clean = name.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!clean || clean.split("/").includes("..")) {
    return null;
  }
  return clean;
}
