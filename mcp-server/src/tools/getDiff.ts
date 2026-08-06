import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const inputSchema = {
  ...pullRequestInputSchema
};

export const getDiffTool: ToolDefinition<typeof inputSchema> = {
  name: "get_pr_diff",
  description: "Fetch and format the changed files and patches for a GitHub pull request.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      const files = await context.github.getPRDiff(pr.owner, pr.repo, pr.prNumber);

      if (files.length === 0) {
        return `No changed files found for ${pr.owner}/${pr.repo}#${pr.prNumber}.`;
      }

      const formatted = files.map((file, index) => [
        `## ${index + 1}. ${file.filename}`,
        `Status: ${file.status}`,
        `Changes: +${file.additions} -${file.deletions} (${file.changes} total)`,
        file.previousFilename ? `Previous filename: ${file.previousFilename}` : undefined,
        "Patch:",
        "```diff",
        file.patch || "[No patch available. The file may be binary or too large.]",
        "```"
      ].filter(Boolean).join("\n")).join("\n\n");

      return `Pull request diff for ${pr.owner}/${pr.repo}#${pr.prNumber}\n\n${formatted}`;
    } catch (error) {
      return `Error fetching PR diff: ${formatError(error)}`;
    }
  }
};
