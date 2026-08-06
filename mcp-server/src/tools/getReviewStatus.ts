import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";
import { findLatestReviewDoc } from "../orchestrator";

const inputSchema = {
  ...pullRequestInputSchema
};

export const getReviewStatusTool: ToolDefinition<typeof inputSchema> = {
  name: "get_review_status",
  description: "Check whether a review document already exists for a pull request under docs/pr-reviews/. Returns the path to the latest review doc, or reports that none exists.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      const docPath = await findLatestReviewDoc(context.cwd, pr.prNumber);

      if (!docPath) {
        return `No review document found for ${pr.owner}/${pr.repo}#${pr.prNumber}. Run run_pr_review to generate one.`;
      }

      return `Review document exists for ${pr.owner}/${pr.repo}#${pr.prNumber}: ${docPath}`;
    } catch (error) {
      return `Error checking review status: ${formatError(error)}`;
    }
  }
};
