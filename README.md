<div align="center">

# PR-Review-Agent

### Multi-Agent Pull Request Review for VS Code & GitHub Actions

[![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![Node.js](https://img.shields.io/badge/Node.js-%E2%89%A518-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![MCP](https://img.shields.io/badge/Model_Context_Protocol-server-6E40C9)](https://modelcontextprotocol.io/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)
[![Tests](https://img.shields.io/badge/tests-124%20passing-brightgreen)](#testing)
[![Build](https://img.shields.io/badge/build-passing-brightgreen)](#development)

</div>

A production-ready, multi-agent pull request review system that runs inside VS Code and in
GitHub Actions. One **Orchestrator** coordinates three specialist agents — **Summary**,
**Security**, and **Documentation** — auto-detects open PRs through the GitHub MCP server,
produces a structured documentation file per PR, and posts a formatted review comment back
to GitHub.

---

## Table of Contents

- [What it does](#what-it-does)
- [Architecture](#architecture)
- [Project structure](#project-structure)
- [Installation](#installation)
- [Usage](#usage)
- [VS Code extension](#vs-code-extension)
- [Web dashboard](#web-dashboard)
- [Security scanning](#security-scanning)
- [Testing](#testing)
- [How the review reaches the PR](#how-the-review-reaches-the-pr)
- [Optional LLM review pass](#optional-llm-review-pass)
- [MCP tools](#mcp-tools)
- [Output format](#output-format)
- [Agent communication protocol](#agent-communication-protocol)
- [Development](#development)
- [Troubleshooting](#troubleshooting)
- [Updates](#updates)
- [License](#license)

---

## What it does

- **Auto-detects open PRs** from the git remote (no manual owner/repo/number needed).
- Runs **3 specialist agents in parallel** on each PR's diff.
- **Enriches the Security agent with real scanners** — in CI, [Semgrep](https://semgrep.dev/),
  [Gitleaks](https://github.com/gitleaks/gitleaks), and [Trivy](https://github.com/aquasecurity/trivy)
  run first and their [SARIF](https://sarifweb.azurewebsites.net/) findings are folded into the
  same `🔒 Security Analysis` section — one unified report, not a separate dashboard.
- Writes a merged markdown report to `docs/pr-reviews/PR-{number}-{YYYY-MM-DD}-{sha}.md` —
  one file per reviewed commit, so a re-review never overwrites the last one.
- Keeps **exactly one review comment per PR**, edited in place on every push rather than
  stacked. See [Comment upsert](#comment-upsert-one-comment-per-pr).
- Posts **high and critical findings as inline comments on the diff lines** that caused
  them, in a single batched review call. See [Inline findings](#inline-findings).
- **Retries transient GitHub failures** with backoff, and never retries a write that could
  duplicate a comment. See [Resilience](#resilience-retry-and-throttle).
- Records **one metrics row per review** for the dashboard's trends view.
- Runs an **optional LLM pass** (off by default) for logic problems regex cannot see, plus
  false-positive triage of the rule engine's own findings. See [LLM review pass](#optional-llm-review-pass).
- Exposes **7 VS Code commands**, a **one-click Activity Bar extension**, and a **headless CLI** for CI.
- Tolerates **partial failures** — if one agent (or scanner) errors, the others still produce their sections.
- Ships **124 tests** that need no token, Docker, or network, and gate CI. See [Testing](#testing).

## Architecture

```
                          ┌──────────────────────────┐
                          │   VS Code chat / Tasks    │
                          │   GitHub Actions (CI)     │
                          └─────────────┬────────────┘
                                        │ MCP tools / CLI
                          ┌─────────────▼────────────┐
                          │      ORCHESTRATOR         │
                          │  list_open_prs            │
                          │  get_pr_data (1 fetch)    │
                          │  run_pr_review            │
                          └─────────────┬────────────┘
                       fan out PR context (parallel)
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                          ▼
      ┌───────────────┐        ┌────────────────┐        ┌──────────────────┐
      │  📋 Summary   │        │  🔒 Security    │        │  📚 Documentation │
      │  what/why/    │        │  18-cat regex  │        │  docstrings /     │
      │  impact/      │        │  + SARIF from  │        │  README / change- │
      │  complexity   │        │  scanners →risk│        │  log + autodocs   │
      └───────┬───────┘        └────────┬───────┘        └─────────┬────────┘
              └─────────────────────────┼──────────────────────────┘
                                        ▼
                          ┌──────────────────────────┐
                          │  (optional) LLM pass ⟶ 🤖  │
                          │  logic gaps + FP triage   │
                          └─────────────┬────────────┘
                                        ▼
                          ┌──────────────────────────┐
                          │   MERGE → canonical doc   │
                          │  docs/pr-reviews/PR-*.md  │
                          └─────────────┬────────────┘
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                          ▼
     ┌─────────────────┐      ┌──────────────────┐      ┌──────────────────┐
     │ upsert the one  │      │ inline comments  │      │ runs.jsonl row   │
     │ review comment  │      │ on the diff lines│      │ → trends view    │
     └─────────────────┘      └──────────────────┘      └──────────────────┘
```

In CI the Security agent has two layers: a built-in regex engine (always on, zero
dependencies, works offline) plus **external scanners** — Semgrep, Gitleaks, Trivy —
that run before the agent and hand it [SARIF](https://sarifweb.azurewebsites.net/) it
folds into the same section. See [Security scanning](#security-scanning).

Each agent exists in two forms:

| Form | Location | Used by |
|---|---|---|
| LLM prompt | `.github/agents/*.agent.md` | VS Code chat agents (Ollama) |
| Deterministic handler | `mcp-server/src/agents/*.ts` | `run_pr_review`, CLI, CI |

Both emit the same **agent envelope** and the same markdown section format, so the report
is identical whether produced by the LLM path or the headless path.

## Project structure

```text
pr-review-agent/
├── .github/
│   ├── agents/
│   │   ├── orchestrator.agent.md
│   │   ├── summary.agent.md
│   │   ├── security.agent.md          # multi-agent security specialist
│   │   └── documentation.agent.md     # multi-agent docs specialist
│   └── workflows/
│       └── pr-trigger.yml             # lint → test → build → review (tests gate it)
├── .vscode/
│   ├── mcp.json
│   ├── settings.json
│   └── tasks.json                     # the 7 pr-agent.* commands
├── docs/pr-reviews/                   # generated reports land here
│   └── .runs.jsonl                    # one metrics row per review (git-ignored)
├── mcp-server/
│   ├── src/
│   │   ├── index.ts                   # MCP stdio server
│   │   ├── cli.ts                     # headless CLI (backs tasks + CI)
│   │   ├── loadEnv.ts                 # auto-loads .env (no dotenv dependency)
│   │   ├── orchestrator.ts            # agents → merge → save → upsert + inline
│   │   ├── agents/
│   │   │   ├── types.ts               # envelope + Finding + diff parsing
│   │   │   ├── summaryAgent.ts
│   │   │   ├── securityAgent.ts
│   │   │   ├── documentationAgent.ts
│   │   │   ├── autoScan.ts            # runs Semgrep/Gitleaks/Trivy in Docker
│   │   │   ├── prSources.ts           # fetches the PR's files at head for them
│   │   │   ├── sarif.ts               # dependency-free SARIF reader
│   │   │   ├── runStore.ts            # append-only run metrics + trends
│   │   │   └── llmPass.ts             # optional, flag-gated LLM review pass
│   │   ├── github/githubClient.ts     # Octokit wrapper + retry/throttle + upsert
│   │   └── tools/                     # MCP tool definitions
│   ├── test/                          # 124 tests — units, golden report, rule corpus
│   ├── eslint.config.mjs
│   └── vitest.config.mts
├── web/                               # dashboard: Express + SSE API, React SPA
│   ├── server/src/routes/             # prs · review · reports · settings · metrics
│   └── client/src/
├── vscode-extension/                  # Activity Bar panel: one-click tool shortcuts
│   ├── src/extension.ts
│   └── package.json
├── Dockerfile                         # dashboard image (runs the tests in the build)
├── docker-compose.yml
├── LICENSE                            # MIT
├── .env.example
└── README.md
```

## The MCP server — the brain of the whole system

**Role in one sentence:** it's the single process that actually talks to GitHub, runs
the review agents, writes the report, and posts the comment. Every entry point (VS Code
panel, chat, CLI, GitHub Actions) ultimately makes it do the work.

### What "MCP server" means here

**MCP** = Model Context Protocol — Anthropic's open standard for exposing **tools** to
LLMs over a standard stdio/JSON-RPC interface. This MCP server is a Node process that
advertises 14 tools (`run_pr_review`, `list_open_prs`, `get_pr_data`, etc.). Any
MCP-compatible client (VS Code chat, Claude Desktop, an SDK caller) can discover and
call them.

### The three roles it plays

**1. Tool provider for LLM clients.** [`mcp-server/src/index.ts`](mcp-server/src/index.ts)
starts a stdio MCP server and registers 14 tools via
[`tools/registry.ts`](mcp-server/src/tools/registry.ts). When VS Code chat sees
`#run_pr_review`, it forwards the call to this process; the server executes and returns
structured JSON.

**2. Orchestration engine.** [`orchestrator.ts`](mcp-server/src/orchestrator.ts) is where
the pipeline actually lives:

- resolves owner/repo from git remote,
- makes one `getPrData` call to GitHub,
- runs the 3 deterministic agents ([`summaryAgent.ts`](mcp-server/src/agents/summaryAgent.ts),
  [`securityAgent.ts`](mcp-server/src/agents/securityAgent.ts),
  [`documentationAgent.ts`](mcp-server/src/agents/documentationAgent.ts)) in parallel,
  reporting each one's start and finish through optional callbacks,
- optionally runs the [LLM pass](#optional-llm-review-pass) over their findings,
- merges their envelopes into the canonical markdown,
- writes `docs/pr-reviews/PR-{N}-{date}-{sha}.md`,
- **upserts** the single review comment and posts the worst findings **inline on the diff**,
- appends one metrics row to `docs/pr-reviews/.runs.jsonl`.

**3. Headless CLI.** [`cli.ts`](mcp-server/src/cli.ts) wraps the same orchestrator so it
can be driven without an LLM at all — used by `.vscode/tasks.json` and by
[`.github/workflows/pr-trigger.yml`](.github/workflows/pr-trigger.yml) in CI.

### Why it matters

The **review logic is deterministic and lives here**, not in the LLM. The LLM
(Orchestrator agent) is only a router — it decides *which* tool to call. The server does
the work identically whether it's called from chat, from a CLI script, or from a GitHub
Actions runner. That's why the same PR produces the same report across all three entry
points.

### What would break without it

| Without the MCP server | Consequence |
|---|---|
| No tool provider | VS Code chat's `#run_pr_review` returns "tool unavailable" |
| No orchestrator | Nothing calls GitHub, no report file is written |
| No CLI | The 7 `pr-agent.*` tasks and the GitHub Actions workflow fail |

The `vscode-extension/` panel and the `.github/agents/*.agent.md` prompts are just
*shells around* this server. Kill the server and everything else becomes an empty UI.

## Installation

```bash
cd mcp-server
npm install
npm run build
```

Create your environment file and fill in real values:

```bash
cp .env.example .env
```

| Variable | Required | Purpose |
|---|---|---|
| `GITHUB_TOKEN` | ✅ | GitHub PAT with `repo` + pull-requests scope |
| `ANTHROPIC_API_KEY` | for the LLM pass only | Anthropic API key. The deterministic pipeline needs no key. |
| `PR_AGENT_LLM` | optional | Enable the optional LLM review pass (default `0` — off) |
| `PR_AGENT_LLM_MODEL` | optional | Model for that pass (default `claude-opus-5`) |
| `GITHUB_OWNER` / `GITHUB_REPO` | optional | Override git-remote auto-detection |
| `MCP_SERVER_PORT` | optional | Default 3000 |
| `OLLAMA_MODEL` / `OLLAMA_URL` | optional | Local model for VS Code chat agents |
| `PR_AGENT_CWD` | optional | Repo root the CLI runs against (where `docs/pr-reviews/` is written) |
| `PR_AGENT_AUTO_SCAN` | optional | Auto-run Semgrep/Gitleaks/Trivy in Docker on each review (default on; `0` disables) |
| `PR_AGENT_SARIF_DIR` | optional | Directory the Security agent reads scanner SARIF from (default: `<cwd>/sarif`) |

### Tests, lint, and the build gate

```bash
cd mcp-server
npm test         # 124 tests: units, golden report snapshot, security-rule corpus
npm run lint     # ESLint (flat config) over src/ and test/
npm run build    # tsc → dist/
```

The suite needs no token, no Docker, and no network — which is why CI can run it
as a gate before any review is produced. See [Testing](#testing).

### Running the dashboard in Docker

```bash
cp .env.example .env        # fill in GITHUB_TOKEN and a 32+ char WEB_SECRET_KEY
docker compose up --build   # http://127.0.0.1:4000
```

The image runs the test suite during the build, so a broken agent never reaches a
container. It binds to loopback on purpose — the dashboard still has no auth of
its own, so put a reverse proxy in front before exposing it.

The server and CLI **load `.env` automatically** (via Node's built-in env-file loader),
looking in the current working directory and the repository root — no `dotenv` dependency
and no manual `export` required. Real environment variables still take precedence over
`.env`. When the repository cannot be auto-detected from a git remote (e.g. running the CLI
from a folder that is not a clone of the target repo), set `GITHUB_OWNER` / `GITHUB_REPO`.

> ⚠️ **Never commit `.env`.** `.env.example` is committed and must contain placeholders
> only. If a real token ever lands in a committed file, revoke it at
> <https://github.com/settings/tokens>.

### Using pr-review-agent inside another repo

pr-review-agent can be dropped into any existing repository as a subfolder and
will auto-target that host repo's PRs — no env vars required.

```bash
# inside your host repo
git clone https://github.com/your-org/pr-review-agent
cd pr-review-agent/mcp-server
npm install && npm run build
```

Then run the CLI from anywhere in the host repo tree:

```bash
node pr-review-agent/mcp-server/dist/cli.js reviewCurrent
```

**How auto-detection works:** the CLI walks upward from its own installed
location to find the enclosing host repository, uses that repo's `origin`
remote to identify `owner`/`repo`, and writes `docs/pr-reviews/` at the host
repo's root. If pr-review-agent happens to itself be a git checkout, its own
remote is deliberately skipped so `reviewCurrent` never targets the agent
instead of the host.

**Overrides still win, in the same precedence order as before:**
explicit CLI/tool input > `GITHUB_OWNER` / `GITHUB_REPO` > `PR_AGENT_CWD`
(when set) > nested-clone auto-detection > standalone `process.cwd()`.

A drop-in GitHub Actions workflow lives at
[`.github/workflows/pr-trigger-host.template.yml`](.github/workflows/pr-trigger-host.template.yml)
— copy it into your host repo's `.github/workflows/` and it will run the agent
on every PR of the host repo, with pr-review-agent vendored as a subfolder or
fetched by a checkout step.

**Web dashboard:** start it from inside `pr-review-agent/web/server/` — it
walks up to the host repo the same way the CLI does, so `docs/pr-reviews/`
listings on the dashboard match what `reviewCurrent` writes. No env vars
required; `PR_AGENT_CWD` still overrides.

**Chat agent (`@pr-review-agent` MCP tools in Copilot Chat):** copy
[`docs/host-repo-mcp.template.json`](docs/host-repo-mcp.template.json)
to `<host-repo>/.vscode/mcp.json`, reload VS Code, and switch the Chat view
into Agent mode. This is a Copilot Chat integration — separate from the
Activity Bar panel shipped by the `vscode-extension/` package (install its
VSIX for the panel).

## Usage

### VS Code extension — one-click tool shortcuts

The `vscode-extension/` package adds a **PR Review** panel to the Activity Bar with buttons
that run the MCP tools directly in chat — with the **Orchestrator** agent pre-selected. See
the full guide in **[VS Code extension](#vs-code-extension)** below.

### VS Code commands (Command Palette → "Tasks: Run Task")

| Command | Description |
|---|---|
| `pr-agent.reviewAll` | Detect and review all open PRs |
| `pr-agent.reviewCurrent` | Review the PR for the current branch |
| `pr-agent.summaryOnly` | Run only the Summary agent on a PR |
| `pr-agent.securityOnly` | Run only the Security agent on a PR |
| `pr-agent.docsOnly` | Run only the Documentation agent on a PR |
| `pr-agent.openLastReport` | Open the last generated PR review doc |
| `pr-agent.postComment` | Post the last generated review as a GitHub comment |

### VS Code chat agents

Open the **orchestrator** chat agent and ask it to *"review all open PRs"* or *"review
PR #42"*. It calls the MCP tools, runs the three agents, saves the doc, and posts the
comment. The single-agent chat agents (`summary`, `security`, `documentation`) can be run
individually.

### Headless CLI / CI

```bash
node mcp-server/dist/cli.js reviewAll
node mcp-server/dist/cli.js reviewCurrent 42
node mcp-server/dist/cli.js securityOnly 42
node mcp-server/dist/cli.js postComment 42
```

The GitHub Actions workflow (`.github/workflows/pr-trigger.yml`) runs on every
`opened` / `synchronize` / `reopened` event: it first runs the Semgrep/Gitleaks/Trivy
scanners into `./sarif` (see [Security scanning](#security-scanning)), then runs
`reviewCurrent`, posts the comment, and uploads the report as a workflow artifact. Add
`ANTHROPIC_API_KEY` to repo secrets if you enable an LLM-enhanced pass; the deterministic
pipeline runs with only the built-in `GITHUB_TOKEN`.

## VS Code extension

The `vscode-extension/` package is a small VS Code extension that adds a **PR Review** panel
to the Activity Bar. It doesn't run reviews itself — it's a launcher that opens the Chat view
with the **Orchestrator** agent selected and submits a ready-made `#<tool>` prompt, so the
deterministic MCP tools do the actual work. Think of it as one-click buttons for the tools
you would otherwise type by hand in chat.

### Build & install

```bash
cd vscode-extension
npm install
npm run build              # tsc → dist/extension.js
npm run package            # vsce → pr-review-agent-vscode-<version>.vsix
code --install-extension pr-review-agent-vscode-0.3.0.vsix --force
```

Then reload VS Code (**Developer: Reload Window**). Requirements:

- **VS Code ≥ 1.100** (custom-agent mode selection works best on **1.101+**).
- The **pr-review-agent** MCP server must be defined (`.vscode/mcp.json`) and **started**
  (Command Palette → *MCP: List Servers* → **pr-review-agent** → Start).
- A chat provider in agent mode (GitHub Copilot Chat, or a local Ollama model).

### The panel

Open the **PR Review** icon in the Activity Bar. The panel has:

- **Pull request #** — the PR to act on. Leave blank to be prompted when a tool needs it.
- **Post comment to GitHub** — when on, review tools post the merged comment; when off, they
  only write the local doc. Both fields **persist across reloads** (webview state).
- Three button groups: **Review**, **Inspect**, and **Workspace**.

### Buttons → tools

| Group | Button | MCP tool | Uses PR # | Honors Post toggle |
|---|---|---|---|---|
| Review | **Full review (3 agents)** | `run_pr_review` | ✅ | ✅ |
| Review | **Security** / **Summary** / **Docs** | `run_pr_review` (single agent) | ✅ | ✅ |
| Inspect | **List open PRs** | `list_open_prs` | — | — |
| Inspect | **PR data** | `get_pr_data` | ✅ | — |
| Inspect | **Review status** | `get_review_status` | ✅ | — |
| Workspace | **Open Chat** | — (opens chat in Orchestrator mode) | — | — |
| Workspace | **MCP Config** | — (opens `.vscode/mcp.json`) | — | — |
| Workspace | **Agent Prompt** | — (opens `orchestrator.agent.md`) | — | — |
| Workspace | **Build MCP Server** | — (runs `npm install && npm run build`) | — | — |

### How it works

1. Each button posts a message from the webview to the extension host
   (`runTool` with the tool id, the PR number, and the post toggle; or `command` for the
   Workspace buttons).
2. `runTool` looks the id up in a `SHORTCUTS` map (`tool`, `needsPr`, `postable`, optional
   `agents`). If the tool needs a PR number and the field is blank, it shows an input box.
3. `buildQuery` composes a deterministic chat prompt that **references the tool with
   `#<tool>`** and states the arguments in words, e.g.
   `#run_pr_review Run all three agents on PR #5. Set prNumber to 5, postComment to false.
   Do not post a comment.`
4. `openChatWithQuery` runs `workbench.action.chat.open` with **`mode: "orchestrator"`**
   (the custom agent in `.github/agents/orchestrator.agent.md`). If that mode id isn't
   recognised, it falls back to generic **agent** mode, then to an older command signature,
   and finally copies the prompt to the clipboard so you can paste it manually.
5. The Orchestrator agent receives the prompt, calls the named MCP tool, and the tool runs
   the deterministic pipeline — identical to the CLI path.

Because the prompt names the tool and its arguments explicitly, the chat model only *routes*
the call; the review logic itself is deterministic. Judge results from the **tool output
card** and the saved **`docs/pr-reviews/`** file, not from the model's prose summary.

### Contributed commands

These are also available from the Command Palette (and reusable in keybindings):

- `PR Review Agent: Open Chat` — open chat with the Orchestrator selected.
- `PR Review Agent: Open MCP Config` — open `.vscode/mcp.json`.
- `PR Review Agent: Open Agent Prompt` — open `orchestrator.agent.md`.
- `PR Review Agent: Build MCP Server` — `npm install && npm run build` in `mcp-server/`.
- `PR Review Agent: Run MCP Tool in Chat` — the command behind the panel buttons.

## Web dashboard

A browser client for the same pipeline lives under [`web/`](web/). It is a thin
Express + Server-Sent Events API (`web/server/`) plus a Vite + React + Tailwind SPA
(`web/client/`). The server imports `mcp-server/src/orchestrator.ts` and
`mcp-server/src/github/githubClient.ts` directly, so reviews produced from the
dashboard are byte-for-byte identical to the CLI and MCP-tool paths — no logic is
reimplemented.

```bash
cd web
npm run install:all       # web/, web/server/, web/client/
npm run web:dev           # server :4000, client :5173
```

Feature parity with the VS Code panel: list **open + closed** PRs with filters and
search, open a PR to view its diff and body, run a **full review** or a single agent,
toggle **post-comment-to-GitHub**, watch **true per-agent progress** (each agent flips
state when it actually starts and finishes, via the orchestrator's `onAgentStart` /
`onAgentDone` callbacks), browse and render every generated file under
`docs/pr-reviews/`, read **review trends** from `/api/metrics`, and manage the GitHub /
Anthropic / Ollama settings from a Settings page (tokens AES-256-GCM encrypted at rest,
never sent to the browser in cleartext).

Deployable with the [`Dockerfile`](Dockerfile) and [`docker-compose.yml`](docker-compose.yml)
at the repository root — see [Running the dashboard in Docker](#running-the-dashboard-in-docker).
See [`web/README.md`](web/README.md) for the full HTTP surface.

## Security scanning

The Security agent works in **two layers**. Both feed one section — you never chase
findings across two tools.

### Layer 1 — built-in regex engine (always on)

[`securityAgent.ts`](mcp-server/src/agents/securityAgent.ts) scans every added line
against **18 vulnerability categories** (secrets, injection, SQL/NoSQL, XSS, auth,
CORS/CSP, path-traversal, SSRF, deserialization, weak crypto, open-redirect, cookies,
TLS, prototype-pollution, header-injection, hardcoded values, input-validation,
dependencies), plus a Shannon-**entropy** check for unknown credential shapes. It
honors inline suppressions (`// pr-agent-ignore`, `// nosec`) and dampens severity in
test files. Zero dependencies, runs offline, identical output every time. The rule set
is informed by [Semgrep](https://semgrep.dev/docs/languages/javascript) and
[gitleaks](https://github.com/gitleaks/gitleaks) patterns and the
[OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html).

### Layer 2 — external scanners (automatic)

Three industry-standard open-source scanners run and hand their
[SARIF](https://sarifweb.azurewebsites.net/) to the agent. **They run automatically —
you never invoke them by hand:**

- **Locally**, [`autoScan.ts`](mcp-server/src/agents/autoScan.ts) runs them in Docker at
  the start of every review that includes the Security agent. Because a PR's code
  usually isn't the checked-out branch (and the caller's working directory may not even
  be the right repo — e.g. the web dashboard), the orchestrator first **fetches the PR's
  changed files at the head commit over the GitHub API**
  ([`prSources.ts`](mcp-server/src/agents/prSources.ts)) into a temp directory, and the
  scanners run against *that*. So findings match the PR from **any** entry point (web
  dashboard, VS Code extension, task, CLI) with no local clone or branch switch. SARIF is
  written to `<cwd>/sarif`. Needs **Docker Desktop running**; if Docker is down it falls
  back to Layer 1. Disable with `PR_AGENT_AUTO_SCAN=0`.
- The section reports honestly: `Semgrep OSS (2)` when scanners find things,
  `… ran — no findings beyond the rule engine` when they run clean, and
  `not run — regex engine only` when Docker is down or SARIF is absent.
- **In CI**, [`.github/workflows/pr-trigger.yml`](.github/workflows/pr-trigger.yml) runs
  the same three scanners as explicit steps before the agent. (When SARIF is already
  present, the auto-runner detects it and does not scan twice.)

The scanners:

| Scanner | Role | What it adds over the regex layer |
|---|---|---|
| [Semgrep](https://github.com/semgrep/semgrep) (`p/default` + `p/security-audit` + `p/secrets`) | SAST | 3,000+ community rules with real dataflow / taint analysis across 30+ languages |
| [Gitleaks](https://github.com/gitleaks/gitleaks) | Secrets | Full git-**history** secret scan with a maintained provider ruleset |
| [Trivy](https://github.com/aquasecurity/trivy) | Deps / IaC | Real CVE lookup on manifests + lockfiles, plus IaC misconfiguration and secret scanning |

[`sarif.ts`](mcp-server/src/agents/sarif.ts) — a small, dependency-free reader — parses
those files, maps each result to the agent's `Finding` shape (severity from
`security-severity`/`level`, CWE from rule tags, `file:line` from the location),
**scopes findings to the PR's changed files**, caps the list at 100, and hands them to
the Security agent, which merges them with its Layer-1 findings and recomputes the risk
level. The section ends with an `**External scanners:**` line showing which tools
contributed.

### How the two layers combine

```
review starts ─► auto-run scanners (Docker) ─► semgrep ─┐
                                                gitleaks ─┼─► <cwd>/sarif/*.sarif ─┐
                                                trivy ────┘                        │
                                                                                    ▼
                 Security agent: regex findings + SARIF findings (scoped, deduped)
                                                                                    ▼
                          ## 🔒 Security Analysis  ─►  merged report + PR comment
```

**Graceful degradation.** Layer 2 is optional. If `PR_AGENT_AUTO_SCAN=0`, Docker isn't
running, or `PR_AGENT_SARIF_DIR` is empty, it contributes nothing and the section notes
`External scanners: none — regex engine only`. Behavior is then byte-for-byte the
pre-scanner output, so nothing breaks without Docker.

### Notes & caveats

- Scanners run as `continue-on-error` Docker steps — any one failing never blocks the
  review.
- Docker images are pulled at `:latest`. Pin digests if you need reproducible CI.
- **Gitleaks** is free for personal/public repos; GitHub **organizations** need a free
  license key (`GITLEAKS_LICENSE`).
- Want live pentesting (DAST) too? [Nuclei](https://github.com/projectdiscovery/nuclei-action)
  or [OWASP ZAP](https://github.com/zaproxy/action-baseline) can scan a PR's deployed
  preview URL — that's a separate, target-based layer, not part of diff review.

## Testing

`npm test` in `mcp-server/` runs **124 tests** across seven files. Nothing in the
suite touches the network, Docker, or a GitHub token, so it runs identically on a
laptop and as a CI gate.

| File | What it pins down |
|---|---|
| `test/types.test.ts` | Diff parsing — hunk headers, removed lines not advancing the counter, multi-hunk numbering |
| `test/securityAgent.test.ts` | **The rule corpus** — see below |
| `test/orchestrator.test.ts` | Golden report snapshot, filename/SHA rules, `findLatestReviewDoc`, inline-comment selection |
| `test/runStore.test.ts` | Run records, trend aggregation, append/read round-trip, corrupt-line tolerance |
| `test/githubClient.test.ts` | The retry policy — what is retried, what never is, and how long it waits |
| `test/sarif.test.ts` | SARIF ingestion against real fixtures — scoping, capping, malformed files |
| `test/summaryAgent.test.ts` | Intent inference, complexity scoring, LLM-pass gating |

### The security-rule corpus

The Security agent's claim is "18 categories". The corpus is what makes that
measurable, and it has two halves:

- **Vulnerable** — one snippet per category, each asserted to produce a finding in
  that category. A rule that silently stops matching fails the build.
- **Safe** — ordinary code (a `reduce`, a log line, a hardened `res.cookie`) asserted
  to produce **no** findings at all. This is the half that measures the false-positive
  rate, which is what decides whether a team leaves the bot switched on.

Writing that second half immediately found a real bug: the `cookie` rule's negative
lookahead sat *after* the closing paren, so it inspected whatever followed the call
instead of its arguments — every `res.cookie(...)` was flagged, including correctly
hardened ones. Fixed, with the safe case now pinned in the corpus.

## How the review reaches the PR

The report is written to disk on every run. What happens on GitHub is three separate
things, each independently skippable and none of them able to fail the review.

### Comment upsert — one comment per PR

CI fires on every `synchronize`, so a PR with eight pushes used to collect eight full
review comments. Every comment the agent posts now carries an invisible marker:

```html
<!-- pr-review-agent:review -->
```

Before posting, [`upsertIssueComment`](mcp-server/src/github/githubClient.ts) lists the
PR's comments, finds the most recent one carrying that marker, and **PATCHes it**. A PR
keeps exactly one agent comment, and its edit history is the review history. If the
lookup or the edit fails — say the comment was deleted mid-run — it falls through and
posts a fresh one rather than losing the review.

### Inline findings

Every finding already carried a `file:line`; now the worst ones are posted where they
belong. After the merged comment, the orchestrator turns **high and critical** findings
into inline review comments in a **single** `pulls.createReview` call:

- capped at **20** per review, so a bad PR cannot bury the diff,
- **one comment per line**, even when several rules fire there,
- findings with **no resolved line** are skipped — SARIF results scoped to a whole file,
  dependency-manifest notes — because GitHub rejects a review whose comments miss the diff,
- findings the [LLM pass](#optional-llm-review-pass) dismissed are skipped.

If GitHub rejects the review anyway, it is logged and dropped. Inline comments are an
enhancement; the merged comment still carries every finding.

Set `inlineComments: false` in `runReview` options to turn them off.

### Resilience — retry and throttle

The GitHub client wraps every request through Octokit's own hook system (no extra
dependency) with a retry policy that distinguishes reads from writes:

| Situation | Behaviour |
|---|---|
| Read (`GET`) hits 408 / 429 / 500 / 502 / 503 / 504 | Retry, up to 3 times |
| Write hits 500-class | **Never retried** — a flaky `POST` must not double-post a comment |
| Write rejected *before executing* (429, or 403 with `x-ratelimit-remaining: 0`) | Retried — the request never ran, so a retry is safe |
| Server sends `retry-after` or `x-ratelimit-reset` | Honoured, capped at 60s |
| Otherwise | Exponential backoff with jitter (~0.5s, 1s, 2s) |

The old advice — *"the pipeline retries nothing on its own, so just click again"* — no
longer applies.

### Run metrics

Each completed review appends one JSON line to `docs/pr-reviews/.runs.jsonl`: risk level,
recommendation, severity counts, the rule categories that fired, duration, files changed,
and how many findings were dismissed. The dashboard reads it through `GET /api/metrics`
(aggregate trends) and `GET /api/metrics/runs` (the raw rows).

It is newline-delimited JSON rather than SQLite on purpose: the MCP server ships with no
native modules, and a native SQLite binding would break `npm ci` on any platform without
a prebuilt binary. [`runStore.ts`](mcp-server/src/agents/runStore.ts) is a small module
behind a narrow interface — swap it for a real database when the rows outgrow a file.
Writing a row can never fail a review; errors are logged and swallowed.

## Optional LLM review pass

**Off by default.** The deterministic pipeline needs no API key, and nothing below changes
that — this is an additional section, not a new dependency of the existing ones.

```bash
PR_AGENT_LLM=1
ANTHROPIC_API_KEY=sk-ant-...
```

When enabled, [`llmPass.ts`](mcp-server/src/agents/llmPass.ts) runs **after** the three
deterministic agents, receives the diff plus every finding the rule engine produced, and
returns two things regex structurally cannot:

1. **Observations** — logic errors, missing edge cases, off-by-one and boundary mistakes,
   incorrect error handling, resource leaks, and code whose behaviour contradicts its name.
2. **Dismissals** — findings it judges to be false positives, with a reason. Dismissed
   findings are **annotated, never deleted**: they stay in the Security section so a
   reviewer can disagree, but they are not posted inline and not counted in the metrics.

Design constraints it holds to:

- **Advisory only.** The `APPROVE` / `REQUEST CHANGES` decision stays deterministic. The
  pass writes its own `## 🤖 LLM Review Pass` section and touches nothing else.
- **Never blocks.** No key, no network, a refusal, a malformed reply — every path returns
  null and the review completes exactly as it would have without it.
- **Not a dependency.** `@anthropic-ai/sdk` is an *optional* dependency, imported lazily,
  so the MCP server and CLI run normally with it absent.
- **Bounded.** The diff is truncated to 60k characters and at most 40 findings are offered
  for triage, so one enormous PR cannot produce an unbounded request.

Model defaults to `claude-opus-5`; override with `PR_AGENT_LLM_MODEL`.

## MCP tools

Pipeline tools (orchestrator-facing):

| Tool | Input | Description |
|---|---|---|
| `list_open_prs` | — | List open PRs for the auto-detected repo |
| `get_pr_data` | `prNumber?` | Metadata + files + diff + commits in one call |
| `run_pr_review` | `prNumber?`, `agents?`, `postComment?` | Full pipeline: agents → merge → save → upsert comment + inline findings |
| `post_review_comment` | `prNumber?`, `comment_body` | Post/update the formatted top-level review comment |
| `get_review_status` | `prNumber?` | Report whether a review doc already exists |

Lower-level specialist tools remain available: `get_pr_diff`, `get_file_content`,
`get_commits`, `check_tests`, `post_pr_description`, `post_inline_comment`,
`post_pr_comment`, `request_changes`, `approve_pr`.

> All identifiers auto-detect from the git remote and current branch when omitted. A full
> review uses **≤ 6 GitHub API calls** per PR: metadata, files, commits, list-comments,
> the comment upsert, and one batched inline review.

## Output format

Every review produces `docs/pr-reviews/PR-{number}-{YYYY-MM-DD}-{sha}.md` — the short
head SHA is part of the name, so reviewing the same PR twice in a day produces two files
rather than overwriting one:

```markdown
# PR Review — #{number}: {title}

**Repository**: {owner}/{repo}
**Author**: @{author}
**Branch**: {head} → {base}
**Date**: {YYYY-MM-DD}
**Reviewed by**: PR Review Agent (Orchestrator + 3 agents)

## 📋 Summary
## 🔒 Security Analysis
## 📚 Documentation
## 🤖 LLM Review Pass    ← only when PR_AGENT_LLM=1; advisory, never changes the decision
## ✅ Review Decision   ← status table + APPROVE / REQUEST CHANGES / NEEDS DISCUSSION
```

The decision table's **Risk** column reports each agent's real `risk_level`, and an em
dash for an agent that did not run.

## Agent communication protocol

Every agent returns this envelope, which the orchestrator merges:

```json
{
  "agent": "summary | security | documentation",
  "pr_number": 42,
  "status": "complete | error | skipped",
  "risk_level": "clean | low | medium | high | critical",
  "output_markdown": "## Section\n...",
  "findings_count": 0,
  "processing_time_ms": 1200,
  "findings": [
    {
      "severity": "critical | high | medium | low",
      "file": "src/auth.ts",
      "line": 42,
      "category": "secrets",
      "issue": "Hardcoded GitHub token.",
      "recommendation": "Move it to an environment variable and rotate it.",
      "cwe": "CWE-798",
      "dismissed": false
    }
  ]
}
```

`findings` is **optional and additive** — only the Security agent emits it. It carries the
structured findings behind `output_markdown` so the orchestrator can anchor them to diff
lines as [inline comments](#inline-findings), hand them to the
[LLM pass](#optional-llm-review-pass) for triage, and count them in the
[run metrics](#run-metrics). Agents that omit it behave exactly as before.

## LLM agents vs deterministic agents — how to use each

The three agents (Summary, Security, Documentation) exist in **two implementations** that
produce the same output shape. They can each run standalone, but the normal flow is that
the **LLM agents delegate to the TypeScript agents** via the `run_pr_review` MCP tool.
The TypeScript agents never call the LLM agents — the direction is one-way.

```
┌─ VS Code chat ──────────────────┐         ┌─ CLI / GitHub Actions ─┐
│ You talk to an LLM agent from   │         │ Direct call, no LLM     │
│ .github/agents/*.agent.md       │         │                         │
│                                 │         │                         │
│   Orchestrator (LLM)            │         │   cli.ts                │
│      │ calls MCP tool           │         │      │                  │
│      ▼                          │         │      ▼                  │
│   run_pr_review ────────────────┼─────────┼─► orchestrator.ts       │
│                                 │         │      │                  │
│                                 │         │      ▼                  │
│                                 │         │   TypeScript agents     │
│                                 │         │   (deterministic)       │
└─────────────────────────────────┘         └─────────────────────────┘
```

The **`run_pr_review` MCP tool is the seam.** Above it: LLM. Below it: deterministic code.

### Path 1 — LLM agents (`.github/agents/*.agent.md`)

**When to use.** You want a *conversation*: ask follow-up questions, request different
framing, discuss a finding, or review something the deterministic rules can't reason
about (design smells, unclear intent).

**How to trigger.**

1. Make sure the MCP server is running: *Command Palette → MCP: List Servers →
   pr-review-agent → Start*.
2. Open the VS Code chat panel.
3. In the **mode dropdown** at the top, pick one of:
   - **Orchestrator** — for full reviews (it will call the pipeline through
     `run_pr_review`).
   - **Summary** / **Security** / **Documentation** — for a single-agent conversation.
4. Type a normal-language request: `review PR #42`, `look at PR #7 for security issues
   only`, `explain the third finding on PR #12`.

**What happens.** The LLM reads its prompt from the `.md` file and calls MCP tools.
Orchestrator → `run_pr_review` → deterministic pipeline. Single-agent LLM
(e.g. Security) → `get_pr_diff` + `get_file_content`, then writes the section itself.

### Path 2 — TypeScript agents (`mcp-server/src/agents/*.ts`)

**When to use.** You want deterministic, fast, free results — CI runs, batch reviews,
scripting, or anything where an LLM would be overkill.

**How to trigger — three ways, same underlying code.**

- **A) VS Code Activity Bar panel** — click a button (Full review, Security, …). The
  panel opens chat with the Orchestrator LLM and a pre-baked `#run_pr_review …` prompt;
  the LLM does nothing but route the call.
- **B) VS Code tasks** — *Command Palette → Tasks: Run Task → `pr-agent.reviewAll`* (or
  reviewCurrent, securityOnly, …). Backed by [`.vscode/tasks.json`](.vscode/tasks.json),
  which runs the CLI directly. No LLM involved.
- **C) Direct CLI**
  ```bash
  node mcp-server/dist/cli.js reviewAll
  node mcp-server/dist/cli.js reviewCurrent 42
  node mcp-server/dist/cli.js securityOnly 42
  node mcp-server/dist/cli.js postComment 42
  ```
  The GitHub Actions workflow uses form C on every PR event.

**What happens.** `cli.ts` (or `run_pr_review` from the panel) calls `runReview()` in
`orchestrator.ts`: one GitHub fetch → three TS agents in parallel → merged markdown →
report file → optional comment. Byte-for-byte identical every time.

### Do they call each other?

| Direction | Happens? | How |
|---|---|---|
| **LLM agent → MCP tool → TypeScript agent** | ✅ | Orchestrator LLM calls `run_pr_review`, which invokes the TS agents. Normal path from chat. |
| **LLM agent → LLM agent** | ✅ (indirect) | Orchestrator can consult the specialist LLMs by prompting itself. Not through code. Rare. |
| **TypeScript agent → LLM** | ❌ | The agents themselves never call a model. The orchestrator can run one optional pass *after* them ([LLM review pass](#optional-llm-review-pass)), off by default — so the default pipeline still works offline in CI with no API key. |
| **TypeScript agent → TypeScript agent** | ❌ | They run in parallel and don't talk. The orchestrator collects their envelopes. |

### Rule of thumb — which to use

| Situation | Use |
|---|---|
| Automated CI on every PR | TypeScript agents (via GitHub Actions) |
| Quick review of one PR while coding | Panel button → TypeScript agents |
| You want to *discuss* a finding | LLM agent in chat |
| Reviewing a subtle design PR that regex can't catch | LLM single-agent mode (Security or Summary) |
| Batch review of many open PRs | CLI: `node dist/cli.js reviewAll` |
| Zero-cost, offline, no API keys | Anything except the LLM chat path |

## Development

```bash
cd mcp-server
npm run test        # 124 tests (vitest) — no token, Docker, or network needed
npm run test:watch  # the same suite, re-running on change
npm run lint        # eslint over src/ and test/
npm run format      # prettier --write
npm run build       # compile to dist/
npm run typecheck   # tsc --noEmit, zero errors required
npm run dev         # run the MCP server from source via tsx
```

`npm test`, `npm run lint`, and `npm run build` are exactly what CI runs, in that order —
if all three pass locally, the workflow will pass too.

**Dependency notes.** Every version is pinned to a real semver range; `"latest"` is not
used anywhere. `@octokit/rest` is held on the **20.x** line because 21+ is ESM-only and
this package emits CommonJS. `zod` is `^3.25`, which ships both the v3 and v4 APIs — MCP
tool definitions use v3, and `llmPass.ts` imports `zod/v4` for the Anthropic SDK's
structured-output helper. `@anthropic-ai/sdk` is an **optional** dependency: everything
except the [LLM pass](#optional-llm-review-pass) works with it absent.

## Troubleshooting

- **No open PRs** — `list_open_prs` returns a clear message; the pipeline does not invent a PR.
- **MCP server won't start** — rebuild (`npm run build`) and confirm `GITHUB_TOKEN` is set in the environment that launched VS Code.
- **Inline comment rejected** — GitHub only accepts inline comments on lines present in the diff.
- **Workflow not triggering** — confirm it lives in `.github/workflows/` (plural). GitHub Actions only discovers workflows in that directory.
- **Extension opens chat but not the Orchestrator** — custom-agent mode selection needs VS Code **1.101+**. On older builds it falls back to generic agent mode; pick **orchestrator** from the chat mode dropdown manually, or update VS Code.
- **Extension button does nothing / "tools unavailable"** — the **pr-review-agent** MCP server isn't running. Start it (*MCP: List Servers* → Start) and make sure you're in **Agent** mode so the `#`-referenced tools resolve.
- **Transient `500` from GitHub** mid-review — reads now retry with backoff on their own ([Resilience](#resilience-retry-and-throttle)). If a *write* fails you will see it surface immediately; that is deliberate, since retrying a write could post the same comment twice. Re-run the tool — the comment upsert makes a re-run idempotent.
- **Inline comments did not appear** — GitHub only accepts them on lines present in the diff, and rejects the whole review if any one comment misses. The rejection is logged to stderr and the merged comment still carries every finding.
- **`npm test` fails after editing a security rule** — that is the [rule corpus](#the-security-rule-corpus) doing its job. Check whether the rule still fires on its vulnerable snippet, or has started firing on a safe one.

---

## Updates

A running log of changes made to this project. Newest first. Dates are `YYYY-MM-DD`.

### 2026-08-05 — Tests, comment upsert, inline findings, and hardening

Ten improvements identified in a review of the project, applied together. The
deterministic spine is unchanged: every entry point still calls the same
`runReview()`, and the CLI/CI behaviour is identical except where noted.

**Added**
- **A test suite — 124 tests** (`mcp-server/test/`, Vitest). Units on the pure
  functions, a **golden snapshot** of the merged report, and a **security-rule
  corpus** with a vulnerable half (one snippet per category) and a safe half that
  measures false positives. No token, Docker, or network required. See
  [Testing](#testing).
- **`npm run lint` and `npm test` as CI gates** in `.github/workflows/pr-trigger.yml`,
  ahead of the build and review steps.
- **Inline review comments.** High and critical findings are now posted on the diff
  lines that caused them, in a single `pulls.createReview` call, capped at 20 and
  deduplicated per line. Findings with no resolved line are skipped, since GitHub
  rejects a review whose comments miss the diff. If the review is rejected anyway,
  it is logged and dropped — the merged comment still carries every finding.
- **Retry and throttle on the GitHub client**, built on Octokit's own hook system
  (no new dependency). Reads back off and retry on 408/429/5xx; **writes retry only
  when the request was rejected before executing** (rate limit), so a flaky 500 can
  never post the same comment twice. Honours `retry-after` and `x-ratelimit-reset`,
  capped at 60s.
- **A run store** (`docs/pr-reviews/.runs.jsonl`) — one append-only row per review
  with risk, severity counts, categories, duration, and dismissals. New dashboard
  routes `GET /api/metrics` (trends) and `GET /api/metrics/runs`. Deliberately
  newline-delimited JSON rather than SQLite: a native binding would break `npm ci`
  on any platform without a prebuilt binary.
- **An optional LLM review pass** (`PR_AGENT_LLM=1`). Runs *after* the deterministic
  agents, adds one advisory section — logic problems regex cannot see, plus a
  false-positive verdict on the rule engine's own findings — and marks dismissed
  findings so they are not posted inline. Off by default; the SDK is an optional
  dependency and is imported lazily, so the pipeline runs with it absent.
- **`LICENSE`** (MIT, matching the badge), **ESLint flat config + Prettier**,
  **`Dockerfile` + `docker-compose.yml`** for the dashboard, and a `.dockerignore`.
  The image runs the test suite during the build.

**Changed**
- **The PR comment is upserted, not re-posted.** The body carries a hidden
  `<!-- pr-review-agent:review -->` marker; a later run finds that comment and edits
  it. A PR now keeps exactly one agent comment whose history is its edit history,
  instead of one per push.
- **Per-agent progress is real.** `runReview` takes optional `onAgentStart` /
  `onAgentDone` callbacks; the dashboard uses them so each agent flips state when it
  actually starts and finishes. Both default to no-ops, so CLI and CI are unaffected.
  Resolves the TODO in `web/README.md`.
- **Review reports are named `PR-{n}-{date}-{sha}.md`.** `findLatestReviewDoc` still
  matches the old date-only name, so existing reports are found.
- **Dependencies are pinned** to real semver ranges across `mcp-server/` and
  `web/server/` — five packages were on `"latest"`, so builds were not reproducible.

**Fixed**
- **The Documentation risk cell was the hardcoded string `"Low"`** in the decision
  table, regardless of what the agent reported. It now shows the real level, and an
  em dash when that agent did not run.
- **Two reviews on the same day silently overwrote each other** — the filename was
  date-only. The head SHA is now part of it.
- **The `cookie` rule flagged every `res.cookie(...)` call**, including correctly
  hardened ones: its negative lookahead sat *after* the closing paren, so it
  inspected what followed the call rather than its arguments. Found by writing the
  safe half of the rule corpus.
- **`npm start` in `web/server` pointed at a path that is never built.** Because the
  API compiles `mcp-server/src` alongside its own, `tsc` emits to
  `dist/web/server/src/index.js`; the script said `dist/index.js`.
- **`@octokit/rest` was resolving to an ESM-only major** that a CommonJS build
  cannot `require()` at runtime. Pinned to the 20.x line, which is CommonJS.
- **The web server's tsconfig compiled the MCP stdio server** it never imports,
  dragging the MCP SDK into a package that does not depend on it. Scoped to what
  the dashboard actually uses.

**Verified**
- `npm test` — 124 passing. `npm run lint` — clean. `npm run build` — clean.
- `tsc --noEmit` clean on `mcp-server` (src and tests), `web/server`, and `web/client`.

### 2026-07-07 — Scanners scan the PR's real code (works from any entry point)

**Fixed**
- **Local scanners now match the PR being reviewed, from every entry point.** Previously
  the scanners scanned the checked-out working tree (usually `main`), so their findings
  almost never lined up with a PR whose branch wasn't checked out — and from the **web
  dashboard** (whose working dir isn't the target repo at all) they couldn't scan the PR
  code. The section showed `External scanners: none` even with Docker running.
- Fix: the orchestrator now fetches the PR's changed files at the head commit **over the
  GitHub API** ([`prSources.ts`](mcp-server/src/agents/prSources.ts)) into a temp dir, and
  the scanners run against that. This is clone-independent, so it works identically from
  the web dashboard, VS Code extension, tasks, and CLI, with no branch switching. The temp
  dir is always cleaned up.
- **Honest scanner status.** The `External scanners:` line now distinguishes
  *found-something* (`Semgrep OSS (2)`), *ran-and-clean*
  (`… ran — no findings beyond the rule engine`), and *didn't-run*
  (`not run — regex engine only`) — previously a clean scan was indistinguishable from no
  scan.

### 2026-07-07 — Scanners run automatically on every review

**Added**
- **`mcp-server/src/agents/autoScan.ts`** — the external scanners now run
  **automatically** at the start of any review that includes the Security agent, so
  you no longer run Docker commands by hand. The orchestrator calls `autoRunScanners`
  before the agents; it runs Semgrep/Gitleaks/Trivy in Docker, writes SARIF to
  `<cwd>/sarif`, and points `PR_AGENT_SARIF_DIR` at it for the agent to ingest.
- **`PR_AGENT_AUTO_SCAN`** env toggle (default on; `0`/`false`/`off` disables).

**Design notes**
- **Requires Docker running.** If Docker Desktop isn't up (or isn't installed), the
  step logs one stderr hint and falls back to the regex engine — the review still
  completes.
- **No double-scanning.** If SARIF already exists in the target dir (e.g. CI ran the
  scanners as explicit steps), the auto-runner detects it and skips.
- **Non-blocking.** Each scanner is best-effort with a 5-minute cap; one failing never
  breaks the review. Logs go to stderr only (stdout is the MCP JSON-RPC channel).
- Works from every entry point — CLI, VS Code panel, web dashboard, MCP chat — because
  it lives in the shared orchestrator.

### 2026-07-07 — External scanners folded into the Security agent (one report)

**Added**
- **SARIF ingestion in the Security agent.** Three industry-standard open-source
  scanners now run in CI and their findings are merged directly into the agent's
  `## 🔒 Security Analysis` section — **one unified report**, not a separate dashboard.
  This is the proven GHAS-replacement stack:
  - **Semgrep** (SAST) — `p/default` + `p/security-audit` + `p/secrets`: 3,000+
    community rules with real dataflow/taint analysis, beyond the agent's line-level
    regexes.
  - **Gitleaks** (secrets) — full git-*history* secret scan with a maintained
    provider ruleset.
  - **Trivy** (deps / IaC) — real CVE lookup on manifests/lockfiles plus
    misconfiguration and secret scanning of the checked-out source.
- **`mcp-server/src/agents/sarif.ts`** — a small, dependency-free SARIF reader. It
  parses every `*.sarif` in `PR_AGENT_SARIF_DIR` (default: cwd), maps results to the
  agent's `Finding` shape (severity from `security-severity`/`level`, CWE from rule
  tags, file+line from the location), scopes them to the PR's **changed files**, and
  caps the list at 100 to prevent flooding.
- **`.github/workflows/pr-trigger.yml`** now runs the three scanners (as Docker steps,
  `continue-on-error`) *before* the agent, writing SARIF into `./sarif`; the review
  step points `PR_AGENT_SARIF_DIR` at it. The agent's report becomes the single place
  every finding lands (local doc + PR comment).

**Changed**
- `runSecurityAgent(context, cwd?)` takes an optional `cwd`; the orchestrator passes
  `context.cwd`. The Security section gains an **External scanners:** line showing
  which tools contributed and how many findings.

**Design notes**
- **Backward-compatible.** When no SARIF is present (local runs, scanners disabled),
  the agent behaves exactly as before and the report notes `regex engine only`. No new
  runtime dependencies; SARIF reads are synchronous, so the pipeline stayed sync.
- **Scoped to the PR.** Scanner findings in files the PR didn't touch are dropped, so
  the review stays about *this* change — consistent with the "only added lines" rule.
- Scanners are best-effort: any one failing (`continue-on-error`) never blocks the
  review.
- **Gitleaks** is free for personal/public repos; organizations need a free license
  key (`GITLEAKS_LICENSE`). Docker images use `:latest` — pin digests for
  reproducible CI.

**Verified**
- `npm run build` + `npm run typecheck` pass with zero errors.
- End-to-end: fed sample Semgrep/Gitleaks SARIF to the built agent — findings merged
  with correct severity/CWE, an out-of-PR-scope finding was filtered out, and the
  no-SARIF path produced the unchanged clean report.

**Sources**: [Semgrep](https://semgrep.dev/) · [Gitleaks](https://github.com/gitleaks/gitleaks) ·
[Trivy](https://github.com/aquasecurity/trivy) ·
[SARIF format](https://sarifweb.azurewebsites.net/) ·
[GHAS-alternative stack writeup](https://devsecops.ae/blog/github-advanced-security-alternative-claude-code-2026/).

### 2026-07-06 — Web dashboard

**Added**
- **`web/` — a browser dashboard** that is a third entry point into the existing
  pipeline, alongside the CLI and the VS Code extension. Two packages:
  - **`web/server/`** — Express + Server-Sent Events API that imports
    `mcp-server/src/orchestrator.ts` and `mcp-server/src/github/githubClient.ts`
    directly. Reviews produced here are identical to `node dist/cli.js reviewCurrent`.
    Routes: `/api/prs` (open/closed/detail/status), `/api/review` (run + postComment),
    `/api/reports` (list + read), `/api/settings` (get/save/test), `/api/events` (SSE).
  - **`web/client/`** — Vite + React + Tailwind + Framer Motion + TanStack Query SPA.
    Dark-mode-first developer-tool aesthetic. Pages: Dashboard (open + closed PR
    lists, filter/search, has-report chip), PR detail (metadata + rendered report +
    live agent progress panel + severity breakdown chart + full-review / single-agent
    actions + post-comment toggle), Reports viewer, Settings (masked tokens,
    reveal-typed-only, test-connection button). Framer Motion for page/panel
    transitions and agent-state changes; skeleton loaders for every async panel;
    TanStack Query for caching + background revalidation instead of polling; SSE for
    live progress instead of polling `get_review_status`.
- **Root scripts** — see `web/package.json`: `web:dev`, `web:build`, `web:start`,
  `web:typecheck` (run from the `web/` directory).
- **Settings encryption.** Tokens are stored in `web/server/.web-settings.json`
  encrypted with AES-256-GCM using a key derived from `WEB_SECRET_KEY`. The API
  never returns cleartext secrets to the browser — the Settings UI only shows a
  masked preview.

Nothing under `mcp-server/`, `vscode-extension/`, or `.github/` was modified; the
web layer is purely additive and reuses the deterministic pipeline through direct
imports.

### 2026-07-04 — Reusable skill library for the LLM agents

**Added**
- **16 skill guides** under `.github/skills/`, each a self-contained prompt fragment the
  LLM agents include by reference. Every `.agent.md` now opens with a `## Skills` block
  listing its shared + specialist skills, so the same guidance isn't copy-pasted (and
  cannot drift) across the four agent files.

| Group | Skill | Used by |
|---|---|---|
| Shared | [diff-reading](.github/skills/diff-reading.md) | all agents |
| Shared | [envelope-protocol](.github/skills/envelope-protocol.md) | all agents |
| Shared | [file-path-linking](.github/skills/file-path-linking.md) | all agents |
| Shared | [tone-and-length](.github/skills/tone-and-length.md) | all agents |
| Security | [severity-scoring](.github/skills/severity-scoring.md) | Security |
| Security | [secret-triage](.github/skills/secret-triage.md) | Security |
| Security | [owasp-cwe-mapping](.github/skills/owasp-cwe-mapping.md) | Security |
| Security | [false-positive-guard](.github/skills/false-positive-guard.md) | Security |
| Summary | [pr-summary-shape](.github/skills/pr-summary-shape.md) | Summary |
| Summary | [complexity-heuristics](.github/skills/complexity-heuristics.md) | Summary |
| Summary | [what-not-to-say](.github/skills/what-not-to-say.md) | Summary |
| Documentation | [docstring-styles](.github/skills/docstring-styles.md) | Documentation |
| Documentation | [changelog-format](.github/skills/changelog-format.md) | Documentation |
| Documentation | [readme-drift](.github/skills/readme-drift.md) | Documentation |
| Orchestrator | [routing-decision](.github/skills/routing-decision.md) | Orchestrator |
| Orchestrator | [merge-conflict-policy](.github/skills/merge-conflict-policy.md) | Orchestrator |

Skills only affect the **LLM chat path** (`.github/agents/*.agent.md`). The deterministic
TypeScript agents in `mcp-server/src/agents/` embed the same policies as code — the two
paths stay in sync by design.

### 2026-07-04 — Advanced Security agent (Semgrep/gitleaks-inspired rules + skills)

**Added**
- **9 new vulnerability categories** in the deterministic Security agent, informed by
  Semgrep JS rulesets, gitleaks default patterns, and the OWASP Top 10 code-review
  checklist: `path-traversal`, `ssrf`, `deserialization`, `crypto`, `open-redirect`,
  `cookie`, `tls`, `prototype-pollution`, and `header-injection`. Total categories
  covered: **18** (was 9).
- **Expanded secret detection**: added Stripe live keys, Slack webhooks & tokens,
  Google API keys, SendGrid, Twilio, Azure Storage connection strings, JWT
  tokens, GitHub `gho_`/`ghs_` prefixes, and PGP private keys — on top of the
  original GitHub/OpenAI/Anthropic/AWS/RSA patterns.
- **Entropy-based generic secret skill.** Any string literal ≥ 20 chars assigned to
  an identifier like `token`, `apiKey`, `secret`, `password`, `access_key`, etc. is
  scored with Shannon entropy; ≥ 4.0 bits/char flags a likely credential the regexes
  don't know about. Skips obvious placeholders (`changeme`, `example`, `your-…`).
- **Inline suppression skill.** A flagged line containing `pr-agent-ignore`, `nosec`,
  or `semgrep: ignore` is skipped — same convention as Bandit/Semgrep, so existing
  suppressions in imported code work out of the box.
- **Test-file severity dampening.** Findings in `**/tests/**`, `**/__tests__/**`, or
  `*.test.*` / `*.spec.*` are demoted one severity step (critical → high, etc.)
  since fixtures routinely contain fake credentials and unsafe patterns.
- **CWE tags** on every rule (e.g. `[CWE-89]` for SQL injection, `[CWE-918]` for
  SSRF), so findings can be mapped to standard classifications.
- **Severity breakdown line** at the top of the section:
  `**Summary:** 1 critical · 2 high · 0 medium · 1 low`.

**Changed**
- Rule engine now records the CWE per finding and dedupes on
  `file:line:category:issue` (was `file:line:category`), so different rules from the
  same category on the same line no longer collapse into one.
- `## 🔒 Security Analysis` section now ends with a one-line hint explaining how to
  suppress a false positive.

**Coverage summary** (categories the agent now checks):

| Category | Example detections |
|---|---|
| `secrets` | GitHub, OpenAI/Anthropic, AWS, Google, Stripe, Slack, SendGrid, Twilio, Azure, JWT, PGP/RSA private keys, high-entropy generic |
| `injection` | `eval`, templated `exec`, `subprocess(shell=True)`, `os.system`, dynamic `new Function`/`require`, `vm.runIn*` |
| `sql` | Concatenated `SELECT/INSERT/UPDATE/DELETE` with `req.*`, MongoDB `$where` |
| `xss` | `dangerouslySetInnerHTML`, `.innerHTML/outerHTML`, `document.write`, `insertAdjacentHTML` |
| `auth` | Stubbed auth checks, JWT `alg:"none"`, `jwt.verify` without explicit algorithms |
| `cors/csp` | `Access-Control-Allow-Origin: *`, `unsafe-inline`/`unsafe-eval` |
| `input-validation` | `req.body/query/params`, `request.args/…` used without a schema |
| `hardcoded` | Private-range IPs, `DEBUG=true` |
| `path-traversal` | `fs.*`/`path.join` with `req.*`, explicit `../../` fragments |
| `ssrf` | `fetch/axios/http.get(req.*)` |
| `deserialization` | `yaml.load`, `pickle.loads`, `marshal.loads`, `node-serialize` |
| `crypto` | MD5/SHA1, DES/RC4/ECB, `Math.random()` for security values, hardcoded IV |
| `open-redirect` | `res.redirect(req.*)` |
| `cookie` | `res.cookie(...)` without `httpOnly` |
| `tls` | `rejectUnauthorized: false`, `NODE_TLS_REJECT_UNAUTHORIZED=0`, `verify=False`, plaintext `http://` for remote hosts |
| `prototype-pollution` | `["__proto__"]`, `constructor.prototype`, `Object.assign({}, req.body)` |
| `header-injection` | `setHeader(..., req.*)` (CRLF risk) |
| `dependencies` | Manifest touched (`package.json`, `requirements.txt`, `go.mod`, `Cargo.toml`, `Pipfile`, `composer.json`, …) |

**Sources**: [Semgrep JavaScript rules](https://semgrep.dev/docs/languages/javascript),
[gitleaks default patterns](https://github.com/gitleaks/gitleaks),
[OWASP Secure Code Review Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Secure_Code_Review_Cheat_Sheet.html).

### 2026-06-11 — Config loading, repo override, a CORS rule fix, and tool shortcuts

**Added**
- **VS Code extension with one-click tool shortcuts** (`vscode-extension/`). A PR Review
  Activity Bar panel exposes a PR-number field, a "Post comment to GitHub" toggle, and
  buttons that open chat and run the MCP tools directly (`run_pr_review` full or
  single-agent, `list_open_prs`, `get_pr_data`, `get_review_status`). The PR number and
  toggle persist across reloads. Documented in full under
  [VS Code extension](#vs-code-extension).
- **Automatic `.env` loading** via `mcp-server/src/loadEnv.ts` (Node's built-in env-file
  loader, no `dotenv` dependency). Called from both `cli.ts` and `index.ts`, so the
  `GITHUB_TOKEN` in `.env` is picked up without a manual `export`. Real env vars still win.

**Changed**
- **Extension now opens chat with the Orchestrator agent pre-selected** (`mode:
  "orchestrator"`) instead of generic agent mode, with a graceful fallback on older VS Code.
  Both the tool-shortcut buttons and the "Open Chat" button use it. Bumped to **v0.3.0**.

**Fixed**
- **Security agent missed wildcard CORS in `setHeader` form.** The rule only matched the
  header form (`Access-Control-Allow-Origin: *`); it now also matches
  `setHeader("Access-Control-Allow-Origin", "*")`. A real origin value is still not flagged.
- **`GITHUB_OWNER` / `GITHUB_REPO` overrides now work.** `resolveRepository` reads them as a
  fallback before git-remote detection (previously documented but unimplemented), letting the
  CLI/MCP target a repo without a matching git remote in the working directory.
- **`.vscode/mcp.json`** no longer injects empty `${env:*}` values (which blocked the `.env`
  fallback and could stop the server from starting); it now sets `cwd` to the workspace so the
  server finds `.env` and writes reports to the right `docs/pr-reviews/`.

**Removed**
- **Legacy `pr-reviewer.agent.md`** — superseded by the orchestrator + 3 specialist agents.

### 2026-06-09 — Multi-agent review pipeline

**Added**
- **Orchestrator + 3 specialist agents** (Summary, Security, Documentation) coordinated through a single pipeline.
- **Deterministic agent handlers** in `mcp-server/src/agents/` (`summaryAgent.ts`, `securityAgent.ts`, `documentationAgent.ts`, shared `types.ts`) so reviews run headlessly and in CI without an LLM.
- **`orchestrator.ts`** — runs agents in parallel, merges sections into the canonical report, writes `docs/pr-reviews/PR-{number}-{date}.md`, and posts the merged comment. Partial agent failures are isolated.
- **5 new MCP tools**: `list_open_prs`, `get_pr_data`, `run_pr_review`, `post_review_comment`, `get_review_status`.
- **New agent definitions**: `.github/agents/security.agent.md` and `.github/agents/documentation.agent.md`; rewrote `orchestrator.agent.md` and `summary.agent.md`.
- **Headless CLI** (`mcp-server/src/cli.ts`) backing 7 VS Code commands via `.vscode/tasks.json`, plus `review:all` / `review:current` npm scripts.
- **GitHub Actions workflow** at `.github/workflows/pr-trigger.yml` — runs on PR `opened`/`synchronize`/`reopened`, posts the review, and uploads the report as an artifact.
- **`docs/pr-reviews/`** directory with `.gitkeep` for generated reports.

**Changed**
- Extended `GitHubClient` with `listOpenPullRequests()` and added `htmlUrl` / `changedFiles` to PR metadata.
- Renamed the inline-comment tool `post_review_comment` → `post_inline_comment` to free the name for the new formatted top-level review tool; updated `pr-reviewer.agent.md` accordingly.
- `.vscode/settings.json` documents the 7 `pr-agent.*` commands; `.vscode/mcp.json` passes `ANTHROPIC_API_KEY` through to the server.
- Professionalized this README (badges, table of contents, this Updates section).

**Security**
- Replaced a committed GitHub PAT in `.env.example` with a placeholder. **The previously exposed token must be revoked.**

**Verified**
- `npm run build` and `npm run typecheck` pass with zero errors.
- End-to-end offline smoke test: the Security agent correctly flagged a committed token, SQL injection, and unvalidated input; the pipeline produced a `REQUEST CHANGES` report with the correct filename.

> **How to maintain this section:** add a new dated entry at the top for each change set,
> grouped under **Added / Changed / Fixed / Removed / Security** (Keep a Changelog style).
> The Documentation agent generates ready-to-paste entries in this exact format.

---

## License

Released under the [MIT License](https://opensource.org/licenses/MIT).
