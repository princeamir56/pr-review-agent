import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const inputSchema = {
  ...pullRequestInputSchema,
  body: z.string().min(1).describe("Complete Markdown PR description body.")
};

export const postDescriptionTool: ToolDefinition<typeof inputSchema> = {
  name: "post_pr_description",
  description: "Update the pull request body with a professional Markdown description.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      await context.github.updatePRDescription(pr.owner, pr.repo, pr.prNumber, input.body);
      return `Updated PR description for ${pr.owner}/${pr.repo}#${pr.prNumber}.`;
    } catch (error) {
      return `Error updating PR description: ${formatError(error)}`;
    }
  }
};
