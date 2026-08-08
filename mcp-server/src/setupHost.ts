#!/usr/bin/env node
/**
 * Wires a host repository up for VS Code when pr-review-agent is cloned inside
 * it as a subfolder.
 *
 * Why this exists: VS Code discovers `.vscode/mcp.json`, `.vscode/tasks.json`,
 * and `.github/agents/*.agent.md` **only at the workspace root**. In the nested
 * layout the workspace root is the host repo, so pr-review-agent's own copies
 * are invisible and the chat agents, tasks, and MCP server silently never
 * appear. Nothing in the agent's code can change that — the files have to exist
 * at the host root, which is what this script creates.
 *
 * Everything it writes is additive and reversible: existing files are never
 * overwritten without --force, and every path it touches is listed at the end
 * so you can undo it by hand.
 */
import { existsSync, promises as fs } from "node:fs";
import * as path from "node:path";
import { findHostRepoRoot, formatError } from "./github/githubClient";

interface Action {
  label: string;
  path: string;
  status: "created" | "skipped" | "overwritten";
  note?: string;
}

/** pr-review-agent's own root, anchored on its marker file. */
function agentRoot(): string {
  let dir = __dirname;
  for (;;) {
    if (existsSync(path.join(dir, "mcp-server", "package.json"))) {
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) {
      throw new Error("Could not locate pr-review-agent's own root from " + __dirname);
    }
    dir = parent;
  }
}

/**
 * Writes `content` to `target` unless it already exists. Returns what happened
 * so the summary can tell the user exactly which files are new.
 */
async function writeIfAbsent(target: string, content: string, label: string, force: boolean): Promise<Action> {
  const exists = existsSync(target);
  if (exists && !force) {
    return { label, path: target, status: "skipped", note: "already exists — left untouched (use --force to replace)" };
  }
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, content, "utf8");
  return { label, path: target, status: exists ? "overwritten" : "created" };
}

/**
 * Rewrites a template's `${workspaceFolder}/...` paths to point into the nested
 * agent folder. `agentFolder` is the agent's directory name relative to the host
 * root, which is not always literally "pr-review-agent" — users rename clones.
 */
function retarget(template: string, agentFolder: string): string {
  return template.split("${workspaceFolder}/pr-review-agent/").join("${workspaceFolder}/" + agentFolder + "/");
}

async function main(): Promise<void> {
  const force = process.argv.includes("--force");
  const root = agentRoot();
  const host = findHostRepoRoot(root);

  if (!host) {
    console.error("pr-review-agent does not appear to be nested inside another git repository.");
    console.error("");
    console.error("This command is only needed for the nested layout:");
    console.error("    <host-repo>/pr-review-agent/");
    console.error("");
    console.error("If pr-review-agent IS your workspace root, its own .vscode/ and");
    console.error(".github/agents/ already work — nothing to set up.");
    process.exit(1);
  }

  const agentFolder = path.basename(root);
  const actions: Action[] = [];

  // 1. MCP server config — makes the tools available in Copilot Chat.
  const mcpTemplate = await fs.readFile(path.join(root, "docs", "host-repo-mcp.template.json"), "utf8");
  actions.push(
    await writeIfAbsent(
      path.join(host, ".vscode", "mcp.json"),
      retarget(mcpTemplate, agentFolder),
      "MCP server config",
      force
    )
  );

  // 2. Tasks — the pr-agent.* entries in "Tasks: Run Task".
  const tasksTemplate = await fs.readFile(path.join(root, "docs", "host-repo-tasks.template.json"), "utf8");
  actions.push(
    await writeIfAbsent(
      path.join(host, ".vscode", "tasks.json"),
      retarget(tasksTemplate, agentFolder),
      "VS Code tasks",
      force
    )
  );

  // 3. Chat agents. These must be real files at the host root: VS Code reads
  //    .github/agents/ from the workspace root only, and unlike mcp.json there
  //    is no user-level location that works instead.
  const agentsSrc = path.join(root, ".github", "agents");
  const agentsDst = path.join(host, ".github", "agents");
  for (const file of (await fs.readdir(agentsSrc)).filter((f) => f.endsWith(".agent.md"))) {
    const body = await fs.readFile(path.join(agentsSrc, file), "utf8");
    actions.push(await writeIfAbsent(path.join(agentsDst, file), body, "Chat agent: " + file, force));
  }

  // 4. Keep the agent and its generated reports out of the host's git status.
  //    .git/info/exclude is local-only, so this never modifies a tracked file
  //    in someone else's repository.
  const excludePath = path.join(host, ".git", "info", "exclude");
  try {
    const current = existsSync(excludePath) ? await fs.readFile(excludePath, "utf8") : "";
    const wanted = ["/" + agentFolder + "/", "/docs/pr-reviews/", "/sarif/"];
    const missing = wanted.filter((line) => !current.split(/\r?\n/).includes(line));
    if (missing.length > 0) {
      const addition =
        (current.endsWith("\n") || current === "" ? "" : "\n") +
        "\n# Added by pr-review-agent setup:host — local-only, not committed.\n" +
        missing.join("\n") +
        "\n";
      await fs.mkdir(path.dirname(excludePath), { recursive: true });
      await fs.appendFile(excludePath, addition, "utf8");
      actions.push({ label: "git exclude entries", path: excludePath, status: "created", note: missing.join(", ") });
    } else {
      actions.push({ label: "git exclude entries", path: excludePath, status: "skipped", note: "already present" });
    }
  } catch (error) {
    actions.push({ label: "git exclude entries", path: excludePath, status: "skipped", note: formatError(error) });
  }

  console.log("Host repository: " + host);
  console.log("Agent folder   : " + agentFolder + "/");
  console.log("");
  for (const a of actions) {
    const mark = a.status === "created" ? "+" : a.status === "overwritten" ? "~" : "·";
    console.log(` ${mark} ${a.label}`);
    console.log(`   ${a.path}${a.note ? "  (" + a.note + ")" : ""}`);
  }

  const created = actions.filter((a) => a.status !== "skipped").length;
  console.log("");
  if (created === 0) {
    console.log("Everything was already in place. Nothing changed.");
  } else {
    console.log("Done. Reload VS Code (Developer: Reload Window), then:");
    console.log("  • Chat agents  — pick 'orchestrator' from the chat mode dropdown");
    console.log("  • MCP tools    — MCP: List Servers → pr-review-agent → Start");
    console.log("  • Tasks        — Tasks: Run Task → pr-agent.*");
  }
}

main().catch((error: unknown) => {
  console.error("setup:host failed: " + formatError(error));
  process.exit(1);
});
