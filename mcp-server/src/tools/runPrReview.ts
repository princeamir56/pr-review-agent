import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";
import { buildPRContext, runReview, AgentName } from "../orchestrator";

const inputSchema = {
  ...pullRequestInputSchema,
  agents: z
    .array(z.enum(["summary", "security", "documentation"]))
    .optional()
    .describe("Subset of agents to run. Defaults to all three."),
  postComment: z
    .boolean()
    .optional()
    .describe("Whether to post the merged review as a PR comment. Defaults to true.")
};

export const runPrReviewTool: ToolDefinition<typeof inputSchema> = {
  name: "run_pr_review",
  description: "Run the full multi-agent review pipeline on a pull request: fetch PR data, run the Summary, Security, and Documentation agents in parallel, write docs/pr-reviews/PR-{number}-{date}.md, and post the merged review comment to GitHub. Partial agent failures are tolerated.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      const prContext = await buildPRContext(context, pr.owner, pr.repo, pr.prNumber);

      const result = await runReview(context, prContext, {
        agents: input.agents as AgentName[] | undefined,
        postComment: input.postComment
      });

      const agentLines = result.envelopes.map(
        (e) => `- ${e.agent}: ${e.status} (risk: ${e.risk_level}, findings: ${e.findings_count}, ${e.processing_time_ms}ms)`
      );

      return [
        `✅ Review complete for ${result.owner}/${result.repo}#${result.prNumber}: ${result.title}`,
        "",
        `**Overall risk**: ${result.riskLevel}`,
        `**Recommendation**: ${result.recommendation}`,
        "",
        "**Agents:**",
        ...agentLines,
        "",
        `**Doc saved**: ${result.docPath}`,
        result.commentUrl ? `**Comment posted**: ${result.commentUrl}` : "**Comment**: not posted (postComment=false)"
      ].join("\n");
    } catch (error) {
      return `Error running PR review: ${formatError(error)}`;
    }
  }
};
