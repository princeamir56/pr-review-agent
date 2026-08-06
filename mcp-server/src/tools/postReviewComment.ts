import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const inputSchema = {
  ...pullRequestInputSchema,
  comment_body: z.string().min(1).describe("Complete Markdown body of the formatted review comment to post on the PR.")
};

export const postReviewCommentTool: ToolDefinition<typeof inputSchema> = {
  name: "post_review_comment",
  description: "Post a formatted top-level review comment on a pull request (e.g. the merged multi-agent review). For inline line comments use post_inline_comment instead.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      const url = await context.github.postIssueComment(pr.owner, pr.repo, pr.prNumber, input.comment_body);
      return `Posted review comment on ${pr.owner}/${pr.repo}#${pr.prNumber}: ${url}`;
    } catch (error) {
      return `Error posting review comment: ${formatError(error)}`;
    }
  }
};
