import { existsSync, statSync } from "node:fs";
import path from "node:path";

/**
 * Walk upward from `start`, one directory at a time, and return the closest
 * ancestor (inclusive) that contains a `.git` entry. Returns null when the walk
 * reaches the filesystem root without finding one.
 */
export function findEnclosingGitRepo(start: string): string | null {
  let dir = path.resolve(start);
  for (;;) {
    if (isGitRepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

/**
 * Find the first git-repo ancestor of `start` that is strictly above `inner`.
 * Used to resolve the *host* repo when `pr-review-agent` itself is a git repo
 * nested inside another one.
 */
export function findGitRepoAbove(start: string, inner: string): string | null {
  const boundary = path.resolve(inner);
  let dir = path.dirname(boundary);
  for (;;) {
    if (isGitRepoRoot(dir)) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      return null;
    }
    dir = parent;
  }
}

function isGitRepoRoot(dir: string): boolean {
  const gitPath = path.join(dir, ".git");
  if (!existsSync(gitPath)) {
    return false;
  }
  try {
    // Accept both the normal `.git/` directory and a `.git` file (worktrees,
    // submodules). Either counts as a repo root for our purposes.
    const s = statSync(gitPath);
    return s.isDirectory() || s.isFile();
  } catch {
    return false;
  }
}
