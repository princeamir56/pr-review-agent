import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const inputSchema = {
  ...pullRequestInputSchema,
  file: z.string().min(1).describe("Changed file path to comment on."),
  line: z.number().int().positive().describe("Line number on the new version of the file."),
  body: z.string().min(1).describe("Markdown inline review comment body.")
};

export const postCommentTool: ToolDefinition<typeof inputSchema> = {
  name: "post_inline_comment",
  description: "Post an inline review comment on a specific changed line in the pull request.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      await context.github.postReviewComment(pr.owner, pr.repo, pr.prNumber, input.file, input.line, input.body);
      return `Posted inline review comment on ${pr.owner}/${pr.repo}#${pr.prNumber} at ${input.file}:${input.line}.`;
    } catch (error) {
      return `Error posting inline review comment: ${formatError(error)}`;
    }
  }
};
