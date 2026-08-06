import * as vscode from "vscode";

const MCP_CONFIG = ".vscode/mcp.json";
const AGENT_PROMPT = ".github/agents/orchestrator.agent.md";

/**
 * Chat mode selected by default when the extension opens chat. Matches the `name:`
 * of the custom agent in `.github/agents/orchestrator.agent.md`, so the Orchestrator
 * agent is pre-selected. Falls back to generic "agent" mode on VS Code versions that
 * don't recognise the custom mode id.
 */
const DEFAULT_CHAT_MODE = "orchestrator";

/**
 * Definition of a one-click MCP tool shortcut shown in the dashboard. `tool` is the
 * MCP tool name (referenced in chat as `#<tool>`); `needsPr` marks tools that require
 * a PR number; `postable` marks review tools whose `postComment` argument is driven by
 * the dashboard's "Post comment" toggle; `agents` restricts run_pr_review to a subset.
 */
interface ToolShortcut {
  tool: string;
  needsPr: boolean;
  postable: boolean;
  agents?: string[];
}

const SHORTCUTS: Record<string, ToolShortcut> = {
  fullReview: { tool: "run_pr_review", needsPr: true, postable: true },
  securityOnly: { tool: "run_pr_review", needsPr: true, postable: true, agents: ["security"] },
  summaryOnly: { tool: "run_pr_review", needsPr: true, postable: true, agents: ["summary"] },
  docsOnly: { tool: "run_pr_review", needsPr: true, postable: true, agents: ["documentation"] },
  listOpenPrs: { tool: "list_open_prs", needsPr: false, postable: false },
  prData: { tool: "get_pr_data", needsPr: true, postable: false },
  reviewStatus: { tool: "get_review_status", needsPr: true, postable: false }
};

interface RunToolMessage {
  type: "runTool";
  id: string;
  pr?: string;
  post?: boolean;
}

interface CommandMessage {
  type: "command";
  command: string;
}

type InboundMessage = RunToolMessage | CommandMessage;

export function activate(context: vscode.ExtensionContext): void {
  const provider = new DashboardProvider(context.extensionUri);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("prReviewAgent.dashboard", provider),
    vscode.commands.registerCommand("prReviewAgent.openChat", openChat),
    vscode.commands.registerCommand("prReviewAgent.openMcpConfig", () => openWorkspaceFile(MCP_CONFIG)),
    vscode.commands.registerCommand("prReviewAgent.openAgentPrompt", () => openWorkspaceFile(AGENT_PROMPT)),
    vscode.commands.registerCommand("prReviewAgent.buildServer", buildServer),
    vscode.commands.registerCommand("prReviewAgent.runTool", (id: string, pr?: string, post?: boolean) =>
      runTool(id, pr, post)
    )
  );
}

export function deactivate(): void {
  // Nothing to dispose manually; subscriptions are owned by VS Code.
}

class DashboardProvider implements vscode.WebviewViewProvider {
  public constructor(private readonly extensionUri: vscode.Uri) {}

  public resolveWebviewView(webviewView: vscode.WebviewView): void {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri]
    };

    webviewView.webview.html = getDashboardHtml(webviewView.webview);

    webviewView.webview.onDidReceiveMessage(async (message: InboundMessage) => {
      if (message.type === "command") {
        await vscode.commands.executeCommand(message.command);
        return;
      }

      if (message.type === "runTool") {
        await runTool(message.id, message.pr, message.post);
      }
    });
  }
}

/**
 * Builds a chat prompt that invokes the requested MCP tool and submits it to the
 * Chat view in agent mode, where the MCP tools are available. The prompt references
 * the tool with `#<tool>` and states the arguments explicitly so the agent calls it
 * deterministically.
 */
async function runTool(id: string, pr?: string, post?: boolean): Promise<void> {
  const shortcut = SHORTCUTS[id];
  if (!shortcut) {
    void vscode.window.showErrorMessage(`Unknown PR Review tool shortcut: ${id}`);
    return;
  }

  let prNumber: number | undefined;
  if (shortcut.needsPr) {
    prNumber = parsePrNumber(pr);
    if (prNumber === undefined) {
      prNumber = await promptForPrNumber();
      if (prNumber === undefined) {
        return; // user cancelled
      }
    }
  }

  const query = buildQuery(shortcut, prNumber, post ?? false);
  await openChatWithQuery(query);
}

function buildQuery(shortcut: ToolShortcut, prNumber: number | undefined, post: boolean): string {
  const parts: string[] = [`#${shortcut.tool}`];

  if (shortcut.tool === "run_pr_review") {
    const scope = shortcut.agents ? `only the ${shortcut.agents.join(", ")} agent` : "all three agents";
    parts.push(`Run ${scope} on PR #${prNumber}.`);
    parts.push(`Set prNumber to ${prNumber}, postComment to ${post}.`);
    if (shortcut.agents) {
      parts.push(`Set agents to ${JSON.stringify(shortcut.agents)}.`);
    }
    parts.push(post ? "Post the merged review comment to GitHub." : "Do not post a comment.");
  } else if (shortcut.tool === "list_open_prs") {
    parts.push("List every open pull request in this repository.");
  } else if (prNumber !== undefined) {
    parts.push(`Use prNumber ${prNumber}.`);
  }

  return parts.join(" ");
}

function parsePrNumber(value?: string): number | undefined {
  if (!value) {
    return undefined;
  }
  const n = Number.parseInt(value.replace(/^#/, "").trim(), 10);
  return Number.isInteger(n) && n > 0 ? n : undefined;
}

async function promptForPrNumber(): Promise<number | undefined> {
  const input = await vscode.window.showInputBox({
    title: "PR Review Agent",
    prompt: "Enter the pull request number to run this tool on",
    validateInput: (v) => (parsePrNumber(v) === undefined ? "Enter a positive PR number." : undefined)
  });
  return parsePrNumber(input);
}

/**
 * Opens the Chat view and submits the query. Selects the Orchestrator custom agent by
 * default (so the multi-agent pipeline drives the tools), falling back to generic agent
 * mode and then older command signatures so it works across VS Code versions.
 */
async function openChatWithQuery(query: string): Promise<void> {
  for (const mode of [DEFAULT_CHAT_MODE, "agent"]) {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", {
        query,
        mode,
        isPartialQuery: false
      });
      return;
    } catch {
      // This mode (or the options object) isn't supported here — try the next.
    }
  }

  try {
    await vscode.commands.executeCommand("workbench.action.chat.open", query);
    return;
  } catch {
    // Last resort: just focus the chat and copy the query for manual paste.
  }

  await openChat();
  await vscode.env.clipboard.writeText(query);
  void vscode.window.showInformationMessage("Chat query copied to clipboard — paste it into the chat input.");
}

/**
 * Opens the Chat view with the Orchestrator agent pre-selected (no query). Falls back
 * to generic agent mode, then to simply focusing the chat panel.
 */
async function openChat(): Promise<void> {
  for (const mode of [DEFAULT_CHAT_MODE, "agent"]) {
    try {
      await vscode.commands.executeCommand("workbench.action.chat.open", { mode });
      return;
    } catch {
      // Mode unsupported on this VS Code version — try the next.
    }
  }

  try {
    await vscode.commands.executeCommand("workbench.panel.chat.view.copilot.focus");
  } catch {
    await vscode.commands.executeCommand("workbench.action.chat.open");
  }
}

async function openWorkspaceFile(relativePath: string): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) {
    void vscode.window.showWarningMessage("Open the pr-review-agent workspace first.");
    return;
  }

  const uri = vscode.Uri.joinPath(folder.uri, relativePath);
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
}

async function buildServer(): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];

  if (!folder) {
    void vscode.window.showWarningMessage("Open the pr-review-agent workspace first.");
    return;
  }

  const terminal = vscode.window.createTerminal({
    name: "PR Review MCP Build",
    cwd: vscode.Uri.joinPath(folder.uri, "mcp-server").fsPath
  });

  terminal.show();
  terminal.sendText("npm install && npm run build");
}

function getDashboardHtml(webview: vscode.Webview): string {
  const nonce = getNonce();

  return /* html */ `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <title>PR Review Agent</title>
  <style>
    body {
      color: var(--vscode-foreground);
      background: var(--vscode-sideBar-background);
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      margin: 0;
      padding: 14px;
    }

    h2 { font-size: 14px; font-weight: 600; margin: 0 0 6px; }
    h3 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--vscode-descriptionForeground);
      margin: 16px 0 8px;
    }

    p { color: var(--vscode-descriptionForeground); line-height: 1.45; margin: 0 0 12px; }

    button {
      align-items: center;
      background: var(--vscode-button-background);
      border: 0;
      color: var(--vscode-button-foreground);
      cursor: pointer;
      display: flex;
      font: inherit;
      justify-content: center;
      margin: 0 0 8px;
      min-height: 30px;
      padding: 6px 10px;
      width: 100%;
    }

    button:hover { background: var(--vscode-button-hoverBackground); }

    .secondary { background: var(--vscode-button-secondaryBackground); color: var(--vscode-button-secondaryForeground); }
    .secondary:hover { background: var(--vscode-button-secondaryHoverBackground); }

    .row { display: flex; gap: 8px; }
    .row button { margin-bottom: 8px; }

    .field { margin: 0 0 10px; }
    label { display: block; font-size: 12px; margin: 0 0 4px; color: var(--vscode-foreground); }

    input[type="text"] {
      background: var(--vscode-input-background);
      border: 1px solid var(--vscode-input-border, transparent);
      color: var(--vscode-input-foreground);
      font: inherit;
      padding: 5px 8px;
      width: 100%;
      box-sizing: border-box;
    }

    .toggle { display: flex; align-items: center; gap: 8px; margin: 0 0 12px; }
    .toggle input { margin: 0; }
    .toggle label { margin: 0; font-size: 12px; }

    .status {
      border-top: 1px solid var(--vscode-sideBarSectionHeader-border);
      margin-top: 16px;
      padding-top: 12px;
    }

    .status p { margin: 0 0 6px; }

    code {
      color: var(--vscode-textPreformat-foreground);
      font-family: var(--vscode-editor-font-family);
      font-size: 12px;
      overflow-wrap: anywhere;
    }
  </style>
</head>
<body>
  <h2>PR Review Agent</h2>
  <p>Run the MCP tools in chat with one click.</p>

  <div class="field">
    <label for="pr">Pull request #</label>
    <input id="pr" type="text" inputmode="numeric" placeholder="auto / e.g. 5" />
  </div>

  <div class="toggle">
    <input id="post" type="checkbox" />
    <label for="post">Post comment to GitHub</label>
  </div>

  <h3>Review</h3>
  <button data-tool="fullReview">Full review (3 agents)</button>
  <div class="row">
    <button class="secondary" data-tool="securityOnly">Security</button>
    <button class="secondary" data-tool="summaryOnly">Summary</button>
    <button class="secondary" data-tool="docsOnly">Docs</button>
  </div>

  <h3>Inspect</h3>
  <button class="secondary" data-tool="listOpenPrs">List open PRs</button>
  <div class="row">
    <button class="secondary" data-tool="prData">PR data</button>
    <button class="secondary" data-tool="reviewStatus">Review status</button>
  </div>

  <h3>Workspace</h3>
  <button class="secondary" data-command="prReviewAgent.openChat">Open Chat</button>
  <div class="row">
    <button class="secondary" data-command="prReviewAgent.openMcpConfig">MCP Config</button>
    <button class="secondary" data-command="prReviewAgent.openAgentPrompt">Agent Prompt</button>
  </div>
  <button class="secondary" data-command="prReviewAgent.buildServer">Build MCP Server</button>

  <div class="status">
    <p>Server entry: <code>pr-review-agent</code></p>
    <p>Agent file: <code>.github/agents/orchestrator.agent.md</code></p>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    const prInput = document.getElementById("pr");
    const postInput = document.getElementById("post");

    // Persist the PR number and post toggle across panel reloads.
    const saved = vscode.getState() || {};
    if (saved.pr) prInput.value = saved.pr;
    if (typeof saved.post === "boolean") postInput.checked = saved.post;

    function persist() {
      vscode.setState({ pr: prInput.value, post: postInput.checked });
    }
    prInput.addEventListener("input", persist);
    postInput.addEventListener("change", persist);

    for (const button of document.querySelectorAll("button[data-command]")) {
      button.addEventListener("click", () => {
        vscode.postMessage({ type: "command", command: button.dataset.command });
      });
    }

    for (const button of document.querySelectorAll("button[data-tool]")) {
      button.addEventListener("click", () => {
        vscode.postMessage({
          type: "runTool",
          id: button.dataset.tool,
          pr: prInput.value.trim(),
          post: postInput.checked
        });
      });
    }
  </script>
</body>
</html>`;
}

function getNonce(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
  let nonce = "";

  for (let index = 0; index < 32; index += 1) {
    nonce += chars.charAt(Math.floor(Math.random() * chars.length));
  }

  return nonce;
}
