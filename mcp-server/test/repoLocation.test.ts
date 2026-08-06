import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitHubClient } from "../src/github/githubClient";
import { findEnclosingGitRepo, findGitRepoAbove } from "../src/github/repoLocation";
import { resolveRepository } from "../src/tools/types";

const execFileAsync = promisify(execFile);

async function git(cwd: string, ...args: string[]): Promise<void> {
  await execFileAsync("git", args, { cwd });
}

async function initRepoWithRemote(dir: string, remoteUrl: string): Promise<void> {
  await fs.mkdir(dir, { recursive: true });
  await git(dir, "init", "-q");
  await git(dir, "remote", "add", "origin", remoteUrl);
}

async function realpath(p: string): Promise<string> {
  // macOS puts tmp under /var → /private/var; git resolves symlinks, our walk does not.
  return fs.realpath(p);
}

let workspace: string;

beforeEach(async () => {
  workspace = await realpath(await fs.mkdtemp(path.join(os.tmpdir(), "pr-agent-repoloc-")));
});

afterEach(async () => {
  await fs.rm(workspace, { recursive: true, force: true });
});

describe("findEnclosingGitRepo", () => {
  it("returns the directory itself when it is a git repo", async () => {
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");
    expect(findEnclosingGitRepo(workspace)).toBe(workspace);
  });

  it("walks up one level to find the enclosing repo", async () => {
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");
    const child = path.join(workspace, "pr-review-agent");
    await fs.mkdir(child, { recursive: true });
    expect(findEnclosingGitRepo(child)).toBe(workspace);
  });

  it("walks up multiple levels", async () => {
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");
    const deep = path.join(workspace, "a", "b", "c", "d");
    await fs.mkdir(deep, { recursive: true });
    expect(findEnclosingGitRepo(deep)).toBe(workspace);
  });

  it("returns null when no enclosing repo exists up to the root", async () => {
    // workspace itself is not a repo; nothing above it in tmp is either.
    expect(findEnclosingGitRepo(workspace)).toBe(null);
  });
});

describe("findGitRepoAbove", () => {
  it("skips the inner repo and returns the outer one", async () => {
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");
    const inner = path.join(workspace, "pr-review-agent");
    await initRepoWithRemote(inner, "git@github.com:tooling/pr-review-agent.git");

    expect(findGitRepoAbove(inner, inner)).toBe(workspace);
  });

  it("returns null when the inner repo has no enclosing one", async () => {
    const inner = path.join(workspace, "pr-review-agent");
    await initRepoWithRemote(inner, "git@github.com:tooling/pr-review-agent.git");

    expect(findGitRepoAbove(inner, inner)).toBe(null);
  });
});

describe("GitHubClient.detectRepository with upward walk", () => {
  const client = new GitHubClient("test-token");

  it("resolves to the enclosing host repo when cwd itself is not a repo", async () => {
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");
    const nested = path.join(workspace, "pr-review-agent", "mcp-server");
    await fs.mkdir(nested, { recursive: true });

    const info = await client.detectRepository(nested);
    expect(info).toEqual({ owner: "acme", repo: "host" });
  });

  it("walks multiple levels up", async () => {
    await initRepoWithRemote(workspace, "https://github.com/acme/deep.git");
    const nested = path.join(workspace, "a", "b", "c");
    await fs.mkdir(nested, { recursive: true });

    const info = await client.detectRepository(nested);
    expect(info).toEqual({ owner: "acme", repo: "deep" });
  });

  it("throws a clear error when no enclosing repo is found", async () => {
    // workspace has no .git and nothing above it in tmp does either.
    await expect(client.detectRepository(workspace)).rejects.toThrow(
      /Could not detect GitHub repository from git remote origin/
    );
  });
});

describe("resolveRepository precedence", () => {
  const client = new GitHubClient("test-token");

  beforeEach(() => {
    delete process.env.GITHUB_OWNER;
    delete process.env.GITHUB_REPO;
  });

  afterEach(() => {
    delete process.env.GITHUB_OWNER;
    delete process.env.GITHUB_REPO;
  });

  it("explicit input wins over env vars and auto-detection", async () => {
    process.env.GITHUB_OWNER = "env-owner";
    process.env.GITHUB_REPO = "env-repo";
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");

    const info = await resolveRepository({ owner: "arg-owner", repo: "arg-repo" }, { github: client, cwd: workspace });
    expect(info).toEqual({ owner: "arg-owner", repo: "arg-repo" });
  });

  it("env vars win over auto-detection", async () => {
    process.env.GITHUB_OWNER = "env-owner";
    process.env.GITHUB_REPO = "env-repo";
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");

    const info = await resolveRepository({}, { github: client, cwd: workspace });
    expect(info).toEqual({ owner: "env-owner", repo: "env-repo" });
  });

  it("falls back to the walked-up host repo when nothing else is set", async () => {
    await initRepoWithRemote(workspace, "git@github.com:acme/host.git");
    const nested = path.join(workspace, "pr-review-agent");
    await fs.mkdir(nested, { recursive: true });

    const info = await resolveRepository({}, { github: client, cwd: nested });
    expect(info).toEqual({ owner: "acme", repo: "host" });
  });

  it("respects the caller's cwd — mirroring how PR_AGENT_CWD is threaded through", async () => {
    // The CLI reads PR_AGENT_CWD once and passes it as context.cwd; the resolver
    // never consults the env var itself. This test pins that contract: whatever
    // cwd the context carries is what detection sees.
    const other = path.join(workspace, "other-repo");
    await initRepoWithRemote(other, "git@github.com:overridden/repo.git");
    // A separate, unrelated repo the walk would find if we followed process.cwd.
    await initRepoWithRemote(workspace, "git@github.com:should-not-win/repo.git");

    const info = await resolveRepository({}, { github: client, cwd: other });
    expect(info).toEqual({ owner: "overridden", repo: "repo" });
  });
});
