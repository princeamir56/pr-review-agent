import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const inputSchema = {
  ...pullRequestInputSchema,
  body: z.string().min(1).describe("Markdown summary explaining why changes are required.")
};

export const requestChangesTool: ToolDefinition<typeof inputSchema> = {
  name: "request_changes",
  description: "Submit a pull request review requesting changes with a summary of blocking issues.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      await context.github.requestChanges(pr.owner, pr.repo, pr.prNumber, input.body);
      return `Requested changes on ${pr.owner}/${pr.repo}#${pr.prNumber}.`;
    } catch (error) {
      return `Error requesting changes: ${formatError(error)}`;
    }
  }
};
