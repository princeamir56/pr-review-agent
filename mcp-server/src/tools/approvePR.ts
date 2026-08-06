import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const inputSchema = {
  ...pullRequestInputSchema
};

export const approvePRTool: ToolDefinition<typeof inputSchema> = {
  name: "approve_pr",
  description: "Approve the pull request after confirming there are no blocking issues.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      await context.github.approvePR(pr.owner, pr.repo, pr.prNumber);
      return `Approved ${pr.owner}/${pr.repo}#${pr.prNumber}.`;
    } catch (error) {
      return `Error approving PR: ${formatError(error)}`;
    }
  }
};
