import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { Octokit } from "@octokit/rest";
import { findEnclosingGitRepo, findGitRepoAbove } from "./repoLocation";

const execFileAsync = promisify(execFile);

export interface ChangedFile {
  filename: string;
  status: string;
  additions: number;
  deletions: number;
  changes: number;
  patch: string;
  previousFilename?: string;
}

export interface PRMetadata {
  title: string;
  body: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  htmlUrl: string;
  changedFiles: number;
}

export interface OpenPullRequest {
  number: number;
  title: string;
  author: string;
  createdAt: string;
  headBranch: string;
  changedFiles: number | null;
}

export interface RepositoryInfo {
  owner: string;
  repo: string;
}

export interface PullRequestInfo extends RepositoryInfo {
  prNumber: number;
}

/**
 * A single inline review comment, anchored to a line on the RIGHT side of the diff.
 */
export interface InlineComment {
  path: string;
  line: number;
  body: string;
}

/**
 * Hidden HTML marker embedded in every review comment the agent posts. GitHub does
 * not render it, so it is invisible to humans but lets us find our own comment on a
 * later run and edit it in place instead of stacking a new one on every push.
 */
export const REVIEW_COMMENT_MARKER = "<!-- pr-review-agent:review -->";

/** Statuses worth retrying: transient server errors and rate limiting. */
const RETRYABLE_STATUS = new Set([408, 429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;
const MAX_RETRY_DELAY_MS = 60_000;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function statusOf(error: unknown): number | undefined {
  return typeof error === "object" && error !== null && "status" in error
    ? (error as { status?: number }).status
    : undefined;
}

function headersOf(error: unknown): Record<string, string | undefined> {
  if (typeof error !== "object" || error === null || !("response" in error)) {
    return {};
  }
  const response = (error as { response?: { headers?: Record<string, string | undefined> } }).response;
  return response?.headers ?? {};
}

/**
 * How long to wait before retrying, or null when the request should not be retried.
 *
 * Read requests retry on any transient status. Writes only retry when the request
 * was *rejected before executing* (secondary rate limit / quota exhausted), so a
 * flaky 500 can never post the same comment twice.
 */
export function retryDelayMs(error: unknown, attempt: number, method = "GET"): number | null {
  if (attempt >= MAX_RETRIES) {
    return null;
  }

  const status = statusOf(error);
  if (status === undefined) {
    return null;
  }

  const headers = headersOf(error);
  const rateLimited =
    status === 429 ||
    (status === 403 && (headers["x-ratelimit-remaining"] === "0" || headers["retry-after"] !== undefined));

  const isRead = method.toUpperCase() === "GET" || method.toUpperCase() === "HEAD";
  if (!rateLimited && (!isRead || !RETRYABLE_STATUS.has(status))) {
    return null;
  }

  // Throttling: honor the server's own guidance when it gives any.
  const retryAfter = Number(headers["retry-after"]);
  if (Number.isFinite(retryAfter) && retryAfter > 0) {
    return Math.min(retryAfter * 1000, MAX_RETRY_DELAY_MS);
  }

  const reset = Number(headers["x-ratelimit-reset"]);
  if (rateLimited && Number.isFinite(reset) && reset > 0) {
    const waitMs = reset * 1000 - Date.now();
    if (waitMs > 0) {
      return Math.min(waitMs, MAX_RETRY_DELAY_MS);
    }
  }

  // Otherwise exponential backoff with jitter: ~0.5s, 1s, 2s.
  const backoff = 2 ** attempt * 500;
  return Math.min(backoff + Math.random() * 250, MAX_RETRY_DELAY_MS);
}

export class GitHubClient {
  private readonly octokit: Octokit;

  public constructor(token = process.env.GITHUB_TOKEN) {
    if (!token) {
      throw new Error("GITHUB_TOKEN is required. Set it in your environment before starting the MCP server.");
    }

    this.octokit = new Octokit({
      auth: token,
      userAgent: "pr-review-agent/1.0.0"
    });

    this.installResilience();
  }

  /**
   * Retry + throttle, built on Octokit's own hook system so it costs no extra
   * dependency. Wraps every request: transient failures back off and retry instead
   * of surfacing as "re-run the tool yourself".
   */
  private installResilience(): void {
    this.octokit.hook.wrap("request", async (request, options) => {
      let attempt = 0;
      for (;;) {
        try {
          return await request(options);
        } catch (error) {
          const delay = retryDelayMs(error, attempt, options.method ?? "GET");
          if (delay === null) {
            throw error;
          }
          // stdout is the MCP JSON-RPC channel — diagnostics go to stderr only.
          console.error(
            `[pr-agent] ${options.method} ${options.url} failed with ${statusOf(error)}; retrying in ${Math.round(delay)}ms`
          );
          await sleep(delay);
          attempt += 1;
        }
      }
    });
  }

  public async getPRDiff(owner: string, repo: string, prNumber: number): Promise<ChangedFile[]> {
    try {
      const files = await this.octokit.paginate(this.octokit.pulls.listFiles, {
        owner,
        repo,
        pull_number: prNumber,
        per_page: 100
      });

      return files.map((file) => ({
        filename: file.filename,
        status: file.status,
        additions: file.additions,
        deletions: file.deletions,
        changes: file.changes,
        patch: file.patch ?? "",
        previousFilename: file.previous_filename
      }));
    } catch (error) {
      throw new Error(`Failed to fetch PR diff for ${owner}/${repo}#${prNumber}: ${formatError(error)}`);
    }
  }

  public async getFileContent(owner: string, repo: string, filepath: string, ref: string): Promise<string> {
    try {
      const response = await this.octokit.repos.getContent({
        owner,
        repo,
        path: filepath,
        ref
      });

      if (Array.isArray(response.data) || response.data.type !== "file") {
        throw new Error(`${filepath} is not a file`);
      }

      if (!("content" in response.data) || !response.data.content) {
        throw new Error(`${filepath} has no readable content`);
      }

      return Buffer.from(response.data.content, "base64").toString("utf8");
    } catch (error) {
      throw new Error(`Failed to fetch ${filepath} at ${ref}: ${formatError(error)}`);
    }
  }

  public async getCommits(owner: string, repo: string, branch: string): Promise<string[]> {
    try {
      const commits = await this.octokit.repos.listCommits({
        owner,
        repo,
        sha: branch,
        per_page: 20
      });

      return commits.data.map((commit) => {
        const sha = commit.sha.slice(0, 7);
        const author = commit.commit.author?.name ?? "unknown";
        const message = commit.commit.message.split("\n")[0] ?? "";
        return `${sha} ${message} (${author})`;
      });
    } catch (error) {
      throw new Error(`Failed to fetch commits for ${owner}/${repo}@${branch}: ${formatError(error)}`);
    }
  }

  public async getPRMetadata(owner: string, repo: string, prNumber: number): Promise<PRMetadata> {
    try {
      const response = await this.octokit.pulls.get({
        owner,
        repo,
        pull_number: prNumber
      });

      return {
        title: response.data.title,
        body: response.data.body ?? "",
        author: response.data.user?.login ?? "unknown",
        baseBranch: response.data.base.ref,
        headBranch: response.data.head.ref,
        headSha: response.data.head.sha,
        htmlUrl: response.data.html_url,
        changedFiles: response.data.changed_files
      };
    } catch (error) {
      throw new Error(`Failed to fetch PR metadata for ${owner}/${repo}#${prNumber}: ${formatError(error)}`);
    }
  }

  public async updatePRDescription(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    try {
      await this.octokit.pulls.update({
        owner,
        repo,
        pull_number: prNumber,
        body
      });
    } catch (error) {
      throw new Error(`Failed to update PR description for ${owner}/${repo}#${prNumber}: ${formatError(error)}`);
    }
  }

  public async postReviewComment(owner: string, repo: string, prNumber: number, file: string, line: number, body: string): Promise<void> {
    try {
      const metadata = await this.getPRMetadata(owner, repo, prNumber);
      await this.octokit.pulls.createReviewComment({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: metadata.headSha,
        path: file,
        line,
        side: "RIGHT",
        body
      });
    } catch (error) {
      throw new Error(`Failed to post inline comment on ${file}:${line}: ${formatError(error)}`);
    }
  }

  public async postIssueComment(owner: string, repo: string, prNumber: number, body: string): Promise<string> {
    try {
      const response = await this.octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body
      });
      return response.data.html_url;
    } catch (error) {
      throw new Error(`Failed to post PR comment for ${owner}/${repo}#${prNumber}: ${formatError(error)}`);
    }
  }

  /**
   * Post the review comment, or edit the agent's previous one in place.
   *
   * CI fires on every `synchronize`, so a PR with eight pushes used to collect eight
   * full review comments. The body carries an invisible marker; we look for the most
   * recent comment containing it and PATCH that instead, so a PR keeps exactly one
   * agent comment whose history is the edit history.
   */
  public async upsertIssueComment(
    owner: string,
    repo: string,
    prNumber: number,
    body: string
  ): Promise<{ url: string; updated: boolean }> {
    const marked = body.includes(REVIEW_COMMENT_MARKER) ? body : `${REVIEW_COMMENT_MARKER}\n${body}`;

    try {
      const existing = await this.findAgentComment(owner, repo, prNumber);
      if (existing !== null) {
        const response = await this.octokit.issues.updateComment({
          owner,
          repo,
          comment_id: existing,
          body: marked
        });
        return { url: response.data.html_url, updated: true };
      }
    } catch (error) {
      // Listing or patching failed (e.g. the comment was deleted mid-run). Fall
      // through and post a fresh comment rather than losing the review entirely.
      console.error(`[pr-agent] could not update the existing review comment: ${formatError(error)}`);
    }

    const url = await this.postIssueComment(owner, repo, prNumber, marked);
    return { url, updated: false };
  }

  /** Id of the agent's own most recent comment on a PR, or null if it has none. */
  public async findAgentComment(owner: string, repo: string, prNumber: number): Promise<number | null> {
    const comments = await this.octokit.paginate(this.octokit.issues.listComments, {
      owner,
      repo,
      issue_number: prNumber,
      per_page: 100
    });

    for (let index = comments.length - 1; index >= 0; index -= 1) {
      const comment = comments[index];
      if (comment && (comment.body ?? "").includes(REVIEW_COMMENT_MARKER)) {
        return comment.id;
      }
    }
    return null;
  }

  /**
   * Post findings as inline review comments in a single API call.
   *
   * GitHub rejects the whole review if any one comment points at a line that is not
   * part of the diff, so on failure we retry once with the offending comments dropped,
   * then give up quietly — inline comments are an enhancement, never a reason to lose
   * the review.
   */
  public async createReviewWithComments(
    owner: string,
    repo: string,
    prNumber: number,
    commitId: string,
    comments: InlineComment[],
    body?: string
  ): Promise<number> {
    if (comments.length === 0) {
      return 0;
    }

    const payload = comments.map((comment) => ({
      path: comment.path,
      line: comment.line,
      side: "RIGHT" as const,
      body: comment.body
    }));

    try {
      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        commit_id: commitId,
        event: "COMMENT",
        ...(body ? { body } : {}),
        comments: payload
      });
      return payload.length;
    } catch (error) {
      console.error(`[pr-agent] inline review rejected (${formatError(error)}); the merged comment still carries every finding.`);
      return 0;
    }
  }

  public async requestChanges(owner: string, repo: string, prNumber: number, body: string): Promise<void> {
    try {
      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: "REQUEST_CHANGES",
        body
      });
    } catch (error) {
      throw new Error(`Failed to request changes for ${owner}/${repo}#${prNumber}: ${formatError(error)}`);
    }
  }

  public async approvePR(owner: string, repo: string, prNumber: number): Promise<void> {
    try {
      await this.octokit.pulls.createReview({
        owner,
        repo,
        pull_number: prNumber,
        event: "APPROVE",
        body: "Approved after autonomous review. No blocking issues were found."
      });
    } catch (error) {
      throw new Error(`Failed to approve ${owner}/${repo}#${prNumber}: ${formatError(error)}`);
    }
  }

  public parseRemoteUrl(remoteUrl: string): RepositoryInfo {
    const trimmed = remoteUrl.trim();
    const httpsMatch = /^https:\/\/github\.com\/([^/]+)\/([^/.]+)(?:\.git)?$/.exec(trimmed);
    if (httpsMatch?.[1] && httpsMatch[2]) {
      return { owner: httpsMatch[1], repo: httpsMatch[2] };
    }

    const sshMatch = /^git@github\.com:([^/]+)\/([^/.]+)(?:\.git)?$/.exec(trimmed);
    if (sshMatch?.[1] && sshMatch[2]) {
      return { owner: sshMatch[1], repo: sshMatch[2] };
    }

    throw new Error(`Unsupported GitHub remote URL: ${remoteUrl}`);
  }

  public async detectRepository(cwd = process.cwd()): Promise<RepositoryInfo> {
    // Precedence: try `cwd` itself first, then walk upward to any enclosing git
    // repo. When pr-review-agent is cloned as a subfolder inside another repo,
    // the walk resolves the *host* repo — pr-review-agent's own remote (if it
    // even has one) is deliberately skipped so `reviewCurrent` targets the
    // host's PRs, not the agent's.
    const hostRoot = findHostRepoRoot(cwd);
    if (hostRoot) {
      const remote = await tryGetOriginRemote(hostRoot);
      if (remote !== null) {
        return this.parseRemoteUrl(remote);
      }
    }

    const directRemote = await tryGetOriginRemote(cwd);
    if (directRemote !== null) {
      return this.parseRemoteUrl(directRemote);
    }

    const enclosing = findEnclosingGitRepo(cwd);
    if (enclosing) {
      const remote = await tryGetOriginRemote(enclosing);
      if (remote !== null) {
        return this.parseRemoteUrl(remote);
      }
    }

    throw new Error(
      "Could not detect GitHub repository from git remote origin: no enclosing git repository with an 'origin' remote was found."
    );
  }

  public async detectCurrentBranch(cwd = process.cwd()): Promise<string> {
    try {
      const { stdout } = await execFileAsync("git", ["branch", "--show-current"], { cwd });
      const branch = stdout.trim();
      if (!branch) {
        throw new Error("current branch is empty");
      }
      return branch;
    } catch (error) {
      throw new Error(`Could not detect current git branch: ${formatError(error)}`);
    }
  }

  public async detectOpenPullRequest(owner: string, repo: string, branch: string): Promise<number> {
    try {
      const pulls = await this.octokit.pulls.list({
        owner,
        repo,
        state: "open",
        head: `${owner}:${branch}`,
        per_page: 10
      });

      const pull = pulls.data[0];
      if (!pull) {
        throw new Error(`no open pull request found for ${owner}:${branch}`);
      }

      return pull.number;
    } catch (error) {
      throw new Error(`Could not detect open pull request for ${owner}/${repo}@${branch}: ${formatError(error)}`);
    }
  }

  /**
   * List open pull requests for a repository. Returns lightweight metadata for each.
   * `changedFiles` is left null to keep this to a single API call; callers that need
   * the count should fetch it per PR via getPRMetadata.
   */
  public async listOpenPullRequests(owner: string, repo: string): Promise<OpenPullRequest[]> {
    try {
      const pulls = await this.octokit.pulls.list({
        owner,
        repo,
        state: "open",
        sort: "created",
        direction: "desc",
        per_page: 50
      });

      return pulls.data.map((pull) => ({
        number: pull.number,
        title: pull.title,
        author: pull.user?.login ?? "unknown",
        createdAt: pull.created_at,
        headBranch: pull.head.ref,
        changedFiles: null
      }));
    } catch (error) {
      throw new Error(`Could not list open pull requests for ${owner}/${repo}: ${formatError(error)}`);
    }
  }
}

async function tryGetOriginRemote(cwd: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("git", ["remote", "get-url", "origin"], { cwd });
    const trimmed = stdout.trim();
    return trimmed ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * If `cwd` is inside pr-review-agent's own tree AND pr-review-agent is nested
 * inside a larger git repo, return that outer host repo's root. Otherwise null.
 *
 * pr-review-agent's own location is anchored via __dirname, which resolves the
 * same whether the code runs from `dist/` or from source under `src/`.
 */
export function findHostRepoRoot(cwd: string): string | null {
  const agentRoot = getAgentRoot();
  if (!agentRoot) {
    return null;
  }
  const resolvedCwd = path.resolve(cwd);
  if (!isInside(resolvedCwd, agentRoot) && resolvedCwd !== agentRoot) {
    return null;
  }
  return findGitRepoAbove(agentRoot, agentRoot);
}

/**
 * The default target-repo working directory — where `docs/pr-reviews/` lives.
 * `PR_AGENT_CWD` wins; otherwise, when pr-review-agent is cloned inside another
 * git repo, that host repo's root; otherwise the plain `process.cwd()`. Shared
 * by the CLI and the MCP server entrypoint so both agree however each is
 * launched (and the web server's `repoRoot()` follows the same precedence).
 */
export function resolveDefaultCwd(): string {
  const override = process.env.PR_AGENT_CWD?.trim();
  if (override) {
    return override;
  }
  const invoked = process.cwd();
  return findHostRepoRoot(invoked) ?? invoked;
}

function getAgentRoot(): string | null {
  // Anchor on a file that only exists at pr-review-agent's root layout:
  // `mcp-server/package.json`. Walking upward from __dirname finds it whether
  // this module was compiled to `mcp-server/dist/github/`, run from source at
  // `mcp-server/src/github/`, or reached via the web server's own dist tree
  // (which mirrors `web/server/dist/mcp-server/src/github/`). Anchoring on a
  // real file is more robust than fixed `..` arithmetic that breaks whenever
  // an output layout adds or removes a directory level.
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

function isInside(child: string, parent: string): boolean {
  const rel = path.relative(parent, child);
  return rel.length > 0 && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export function formatError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
