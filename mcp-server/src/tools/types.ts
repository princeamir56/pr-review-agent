import { z } from "zod";
import { GitHubClient, PullRequestInfo } from "../github/githubClient";

export interface ToolContext {
  github: GitHubClient;
  cwd: string;
}

export interface ToolDefinition<TSchema extends z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: TSchema;
  execute(input: z.infer<z.ZodObject<TSchema>>, context: ToolContext): Promise<string>;
}

export const repositoryInputSchema = {
  owner: z.string().min(1).optional().describe("GitHub repository owner. Auto-detected from git remote when omitted."),
  repo: z.string().min(1).optional().describe("GitHub repository name. Auto-detected from git remote when omitted.")
};

export const pullRequestInputSchema = {
  ...repositoryInputSchema,
  prNumber: z.number().int().positive().optional().describe("Pull request number. Auto-detected from the current branch when omitted.")
};

export async function resolveRepository(input: { owner?: string; repo?: string }, context: ToolContext): Promise<{ owner: string; repo: string }> {
  // Precedence: explicit input > GITHUB_OWNER/GITHUB_REPO env vars > git remote.
  const owner = input.owner ?? process.env.GITHUB_OWNER?.trim();
  const repo = input.repo ?? process.env.GITHUB_REPO?.trim();
  if (owner && repo) {
    return { owner, repo };
  }

  const detected = await context.github.detectRepository(context.cwd);
  return {
    owner: owner ?? detected.owner,
    repo: repo ?? detected.repo
  };
}

export async function resolvePullRequest(input: { owner?: string; repo?: string; prNumber?: number }, context: ToolContext): Promise<PullRequestInfo> {
  const repository = await resolveRepository(input, context);
  if (input.prNumber) {
    return { ...repository, prNumber: input.prNumber };
  }

  const branch = await context.github.detectCurrentBranch(context.cwd);
  const prNumber = await context.github.detectOpenPullRequest(repository.owner, repository.repo, branch);
  return { ...repository, prNumber };
}

export function truncateMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const half = Math.floor((maxLength - 120) / 2);
  return `${value.slice(0, half)}\n\n[... truncated ${value.length - maxLength} characters ...]\n\n${value.slice(-half)}`;
}
