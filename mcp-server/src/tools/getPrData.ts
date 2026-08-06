import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";
import { buildPRContext } from "../orchestrator";

const inputSchema = {
  ...pullRequestInputSchema
};

export const getPrDataTool: ToolDefinition<typeof inputSchema> = {
  name: "get_pr_data",
  description: "Fetch full data for a pull request in one call: metadata, changed-file list, unified diff, and recent commits. Wraps get_pull_request + get_pull_request_diff + list_pull_request_files. Auto-detects the PR from the current branch when prNumber is omitted.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      const prContext = await buildPRContext(context, pr.owner, pr.repo, pr.prNumber);

      const fileList = prContext.files
        .map((file) => `- ${file.filename} [${file.status}] (+${file.additions}/-${file.deletions})`)
        .join("\n");

      const diff = prContext.files
        .map((file) => [
          `### ${file.filename}`,
          "```diff",
          file.patch || "[No patch available — binary or too large.]",
          "```"
        ].join("\n"))
        .join("\n\n");

      return [
        `# PR Data — ${prContext.owner}/${prContext.repo}#${prContext.prNumber}`,
        "",
        `**Title**: ${prContext.title}`,
        `**Author**: @${prContext.author}`,
        `**Branch**: ${prContext.headBranch} → ${prContext.baseBranch}`,
        `**URL**: ${prContext.htmlUrl}`,
        "",
        "## Description",
        prContext.body || "_No description provided._",
        "",
        `## Changed files (${prContext.files.length})`,
        fileList || "_None._",
        "",
        "## Recent commits",
        prContext.commits.length ? prContext.commits.map((c) => `- ${c}`).join("\n") : "_None._",
        "",
        "## Diff",
        diff || "_No diff._"
      ].join("\n");
    } catch (error) {
      return `Error fetching PR data: ${formatError(error)}`;
    }
  }
};
