import { z } from "zod";
import { formatError } from "../github/githubClient";
import { repositoryInputSchema, resolveRepository, ToolDefinition } from "./types";

const inputSchema = {
  ...repositoryInputSchema
};

export const listOpenPrsTool: ToolDefinition<typeof inputSchema> = {
  name: "list_open_prs",
  description: "List all open pull requests for the current repository (auto-detected from the git remote when owner/repo are omitted). Returns number, title, author, and created date for each.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const repository = await resolveRepository(input, context);
      const prs = await context.github.listOpenPullRequests(repository.owner, repository.repo);

      if (prs.length === 0) {
        return `No open pull requests found in ${repository.owner}/${repository.repo}.`;
      }

      const rows = prs.map((pr) =>
        `- #${pr.number} — ${pr.title} (by @${pr.author}, branch \`${pr.headBranch}\`, opened ${pr.createdAt.slice(0, 10)})`
      );

      return [
        `Open pull requests for ${repository.owner}/${repository.repo} (${prs.length}):`,
        "",
        ...rows,
        "",
        JSON.stringify(
          prs.map((pr) => ({
            number: pr.number,
            title: pr.title,
            author: pr.author,
            created_at: pr.createdAt,
            files_changed: pr.changedFiles
          })),
          null,
          2
        )
      ].join("\n");
    } catch (error) {
      return `Error listing open pull requests: ${formatError(error)}`;
    }
  }
};
