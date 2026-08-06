import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const inputSchema = {
  ...pullRequestInputSchema,
  body: z.string().min(1).describe("Complete Markdown body for a top-level pull request conversation comment.")
};

export const postPrCommentTool: ToolDefinition<typeof inputSchema> = {
  name: "post_pr_comment",
  description: "Post a top-level conversation comment on the pull request. Use this to publish a whole-PR summary.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      const url = await context.github.postIssueComment(pr.owner, pr.repo, pr.prNumber, input.body);
      return `Posted PR comment on ${pr.owner}/${pr.repo}#${pr.prNumber}: ${url}`;
    } catch (error) {
      return `Error posting PR comment: ${formatError(error)}`;
    }
  }
};
