import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { ToolContext } from "./types";
import { getDiffTool } from "./getDiff";
import { getFileTool } from "./getFile";
import { getCommitsTool } from "./getCommits";
import { checkTestsTool } from "./checkTests";
import { postDescriptionTool } from "./postDescription";
import { postCommentTool } from "./postComment";
import { postPrCommentTool } from "./postPrComment";
import { requestChangesTool } from "./requestChanges";
import { approvePRTool } from "./approvePR";
import { listOpenPrsTool } from "./listOpenPrs";
import { getPrDataTool } from "./getPrData";
import { runPrReviewTool } from "./runPrReview";
import { postReviewCommentTool } from "./postReviewComment";
import { getReviewStatusTool } from "./getReviewStatus";

const tools = [
  // Multi-agent pipeline tools (orchestrator-facing)
  listOpenPrsTool,
  getPrDataTool,
  runPrReviewTool,
  postReviewCommentTool,
  getReviewStatusTool,
  // Lower-level GitHub tools (specialist-facing)
  getDiffTool,
  getFileTool,
  getCommitsTool,
  checkTestsTool,
  postDescriptionTool,
  postCommentTool,
  postPrCommentTool,
  requestChangesTool,
  approvePRTool
] as const;

export function registerTools(server: McpServer, context: ToolContext): void {
  for (const tool of tools) {
    registerTool(server, tool, context);
  }
}

function registerTool(server: McpServer, tool: (typeof tools)[number], context: ToolContext): void {
  server.registerTool(
    tool.name,
    {
      description: tool.description,
      inputSchema: tool.inputSchema
    },
    async (input: unknown): Promise<CallToolResult> => {
      const parsed = z.object(tool.inputSchema).parse(input);
      const result = await tool.execute(parsed as never, context);

      return {
        content: [
          {
            type: "text" as const,
            text: result
          }
        ]
      };
    }
  );
}
