import { loadEnv } from "./loadEnv";

loadEnv();

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { GitHubClient, formatError } from "./github/githubClient";
import { registerTools } from "./tools/registry";

async function main(): Promise<void> {
  console.error("[pr-review-agent] Starting MCP server...");

  const server = new McpServer({
    name: "pr-review-agent",
    version: "1.0.0"
  });

  const github = new GitHubClient();
  registerTools(server, {
    github,
    cwd: process.cwd()
  });

  const transport = new StdioServerTransport();

  process.on("SIGINT", () => {
    console.error("[pr-review-agent] Received SIGINT. Shutting down.");
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    console.error("[pr-review-agent] Received SIGTERM. Shutting down.");
    process.exit(0);
  });

  process.on("uncaughtException", (error) => {
    console.error(`[pr-review-agent] Uncaught exception: ${formatError(error)}`);
    process.exit(1);
  });

  process.on("unhandledRejection", (reason) => {
    console.error(`[pr-review-agent] Unhandled rejection: ${formatError(reason)}`);
    process.exit(1);
  });

  await server.connect(transport);
  console.error("[pr-review-agent] MCP server connected over stdio.");
}

main().catch((error: unknown) => {
  console.error(`[pr-review-agent] Startup failed: ${formatError(error)}`);
  process.exit(1);
});
