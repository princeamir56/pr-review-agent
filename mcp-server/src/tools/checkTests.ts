import { z } from "zod";
import { formatError } from "../github/githubClient";
import { pullRequestInputSchema, resolvePullRequest, ToolDefinition } from "./types";

const testPatterns = [
  ".test.",
  ".spec.",
  "__tests__/",
  "__test__/",
  "/test/",
  "/tests/"
];

const inputSchema = {
  ...pullRequestInputSchema
};

export const checkTestsTool: ToolDefinition<typeof inputSchema> = {
  name: "check_tests",
  description: "Detect changed production files that appear to be missing matching test changes.",
  inputSchema,
  async execute(input: z.infer<z.ZodObject<typeof inputSchema>>, context): Promise<string> {
    try {
      const pr = await resolvePullRequest(input, context);
      const files = await context.github.getPRDiff(pr.owner, pr.repo, pr.prNumber);
      const filenames = files.map((file) => file.filename);
      const changedTests = filenames.filter(isTestFile);
      const productionFiles = filenames.filter((file) => !isTestFile(file) && !isGeneratedOrStaticFile(file));
      const missing = productionFiles.filter((file) => !hasMatchingTestChange(file, changedTests));

      return [
        `Test coverage check for ${pr.owner}/${pr.repo}#${pr.prNumber}`,
        "",
        `Changed test files: ${changedTests.length}`,
        changedTests.length ? changedTests.map((file) => `- ${file}`).join("\n") : "- None detected",
        "",
        `Production files without matching test changes: ${missing.length}`,
        missing.length ? missing.map((file) => `- ${file}`).join("\n") : "- None detected",
        "",
        missing.length
          ? "Review guidance: inspect whether these files need new or updated tests based on behavioral risk."
          : "Review guidance: matching test changes were detected for the changed production files."
      ].join("\n");
    } catch (error) {
      return `Error checking tests: ${formatError(error)}`;
    }
  }
};

function isTestFile(filename: string): boolean {
  const normalized = filename.replace(/\\/g, "/").toLowerCase();
  return testPatterns.some((pattern) => normalized.includes(pattern));
}

function isGeneratedOrStaticFile(filename: string): boolean {
  const normalized = filename.toLowerCase();
  return /\.(md|mdx|png|jpg|jpeg|gif|svg|webp|lock|snap)$/.test(normalized)
    || normalized.endsWith("package-lock.json")
    || normalized.endsWith("pnpm-lock.yaml")
    || normalized.endsWith("yarn.lock");
}

function hasMatchingTestChange(file: string, testFiles: string[]): boolean {
  const baseName = file.split(/[\\/]/).pop()?.replace(/\.[^.]+$/, "").toLowerCase();
  if (!baseName) {
    return false;
  }

  return testFiles.some((testFile) => testFile.toLowerCase().includes(baseName));
}
