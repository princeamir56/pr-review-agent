import { z } from "zod";
import { formatError } from "../github/githubClient";
import { repositoryInputSchema, resolveRepository, ToolDefinition } from "./types";

const inputSchema = {
  ...repositoryInputSchema,
  branch: z.string().min(1).optional().describe("Branch name or SHA. Defaults to current git branch.")
};

export const getCommitsTool: ToolDefinition<typeof inputSchema> = {
  name: "get_commits",
  description: "Fetch recent commit messages for a repository branch.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const repository = await resolveRepository(input, context);
      const branch = input.branch ?? await context.github.detectCurrentBranch(context.cwd);
      const commits = await context.github.getCommits(repository.owner, repository.repo, branch);

      if (commits.length === 0) {
        return `No commits found for ${repository.owner}/${repository.repo}@${branch}.`;
      }

      return `Recent commits for ${repository.owner}/${repository.repo}@${branch}\n\n${commits.map((commit) => `- ${commit}`).join("\n")}`;
    } catch (error) {
      return `Error fetching commits: ${formatError(error)}`;
    }
  }
};
