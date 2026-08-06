import { ChangedFile } from "../src/github/githubClient";
import { PRContext } from "../src/agents/types";

/**
 * Build a unified-diff patch from added lines, starting at `startLine` on the
 * new side. Keeps the security-rule tests readable: a test states the code it
 * cares about, not the hunk header syntax.
 */
export function patchOf(lines: string[], startLine = 1): string {
  return [`@@ -0,0 +${startLine},${lines.length} @@`, ...lines.map((line) => `+${line}`)].join("\n");
}

export function fileOf(filename: string, lines: string[], startLine = 1): ChangedFile {
  return {
    filename,
    status: "modified",
    additions: lines.length,
    deletions: 0,
    changes: lines.length,
    patch: patchOf(lines, startLine)
  };
}

/** A minimal PR context. Override any field per test. */
export function contextOf(overrides: Partial<PRContext> = {}): PRContext {
  return {
    owner: "mobelite",
    repo: "pr-review-agent",
    prNumber: 42,
    title: "Add rate limiting to the login endpoint",
    body: "Closes #17.",
    author: "amir",
    baseBranch: "main",
    headBranch: "feat/rate-limit",
    headSha: "a1b2c3d4e5f6a7b8",
    htmlUrl: "https://github.com/mobelite/pr-review-agent/pull/42",
    files: [],
    commits: [],
    ...overrides
  };
}
