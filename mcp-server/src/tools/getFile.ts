import { z } from "zod";
import { formatError } from "../github/githubClient";
import { repositoryInputSchema, resolveRepository, ToolDefinition, truncateMiddle } from "./types";

const inputSchema = {
  ...repositoryInputSchema,
  filepath: z.string().min(1).describe("Repository-relative file path to read."),
  ref: z.string().min(1).describe("Git ref, branch, tag, or commit SHA to read from."),
  maxCharacters: z.number().int().positive().max(100000).optional().describe("Maximum characters to return. Defaults to 30000.")
};

export const getFileTool: ToolDefinition<typeof inputSchema> = {
  name: "get_file_content",
  description: "Read full file content from GitHub at a specific ref, with intelligent truncation for large files.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const repository = await resolveRepository(input, context);
      const maxCharacters = input.maxCharacters ?? 30000;
      const content = await context.github.getFileContent(repository.owner, repository.repo, input.filepath, input.ref);
      const truncated = truncateMiddle(content, maxCharacters);
      const note = truncated.length < content.length ? `\n\nNote: File was truncated from ${content.length} to ${truncated.length} characters.` : "";

      return `File ${repository.owner}/${repository.repo}/${input.filepath}@${input.ref}\n\n\`\`\`\n${truncated}\n\`\`\`${note}`;
    } catch (error) {
      return `Error reading file content: ${formatError(error)}`;
    }
  }
};
