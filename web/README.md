# PR-Review-Agent — Web dashboard

A browser client for the same multi-agent PR review pipeline that powers the VS Code
extension and the CLI. The `web/server/` process **imports `mcp-server/src/orchestrator.ts`
and `mcp-server/src/github/githubClient.ts` directly**, so every review produced from the
dashboard is byte-for-byte identical to `node dist/cli.js reviewCurrent N` and to the
`#run_pr_review` MCP tool. No review logic is reimplemented here.

```
web/
├── server/          Express + SSE API — thin wrapper around mcp-server/src/*
└── client/          Vite + React + Tailwind + Framer Motion + TanStack Query
```

## What the dashboard can do

Feature parity with the VS Code extension panel and the `pr-agent.*` tasks:

| Capability | Backed by |
|---|---|
| List open pull requests | `GitHubClient.listOpenPullRequests` |
| List closed / merged pull requests | Octokit `pulls.list({ state: "closed" })` |
| Load a PR (metadata + files + diff + commits) | `orchestrator.buildPRContext` |
| Run full review (3 agents, parallel) | `orchestrator.runReview` |
| Run single-agent review (Summary / Security / Docs) | `orchestrator.runReview({ agents: [name] })` |
| Live agent progress (pending → running → complete/error) | SSE `/api/events` |
| Post the merged review as a GitHub comment | `GitHubClient.postIssueComment` |
| Read whether a review doc already exists | `findLatestReviewDoc` |
| List & render `docs/pr-reviews/*.md` | `web/server/src/routes/reports.ts` |
| Rendered severity breakdown chart | Parsed from the report's `**Summary:**` line |
| GitHub token / repo / Ollama settings, test connection | `web/server/src/routes/settings.ts` |

## Run it locally

```bash
cd web
npm run install:all       # installs web/, web/server/, web/client/
npm run web:dev           # server on :4000, Vite client on :5173
```

Open <http://localhost:5173>. The Vite dev server proxies `/api/*` to
`http://localhost:4000`, so there is no CORS setup for local development.

Build for production:

```bash
npm run web:build         # tsc for the server, vite build for the client
npm run web:start         # node web/server/dist/index.js
```

Typecheck both packages:

```bash
npm run web:typecheck
```

## Configuration

The server auto-loads `.env` from `web/server/` and from the repo root (same
`loadEnv.ts` the MCP server uses). Persisted settings from the **Settings** page
override env values; on save they are written to `web/server/.web-settings.json`.

| Variable | Purpose |
|---|---|
| `WEB_SERVER_PORT` | HTTP port the API listens on (default 4000). |
| `WEB_SECRET_KEY` | 32+ char random string used to AES-256-GCM encrypt secrets at rest. **Set this before storing real tokens.** |
| `GITHUB_TOKEN` | GitHub PAT with `repo` + pull-requests scope. Encrypted at rest. |
| `GITHUB_OWNER` / `GITHUB_REPO` | Optional overrides for git-remote detection. |
| `ANTHROPIC_API_KEY` | Encrypted at rest. Used for the LLM-enhanced pass. |
| `MCP_SERVER_PORT`, `OLLAMA_MODEL`, `OLLAMA_URL` | Passed through to the shared pipeline. |

## Security posture

- Secrets are stored in `.web-settings.json` (mode `0600`) encrypted with AES-256-GCM.
  The decryption key is derived from `WEB_SECRET_KEY`.
- After a token is saved, it is **never returned to the browser in cleartext**. The
  Settings page shows a masked preview (`ghp_…abcd`) and the "Reveal" button reveals
  only what the current user has typed into the input, not the stored value.
- Owner/repo/PR-number inputs are validated on every route (`/^[\w.-]{1,100}$/`, positive
  integer).
- The API and dev proxy bind to `localhost` by default. If you deploy this, put a proper
  reverse proxy and auth in front of it — the dashboard has no multi-user auth yet
  (see the TODO below).

## HTTP API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/health` | Health probe |
| GET | `/api/prs/repo` | Resolved owner/repo |
| GET | `/api/prs/open` | Open PRs (+ `hasReport`) |
| GET | `/api/prs/closed` | Closed PRs (+ `merged`, `hasReport`) |
| GET | `/api/prs/:n` | Full PR context (metadata + files/diff + commits) |
| GET | `/api/prs/:n/status` | Whether a review doc exists |
| POST | `/api/review/:n/run` | `{ agents?: [...], postComment?: bool }` — runs the pipeline |
| POST | `/api/review/:n/postComment` | Posts the latest saved report as a PR comment |
| GET | `/api/reports` | List reports under `docs/pr-reviews/` |
| GET | `/api/reports/:name` | Read a single report |
| GET | `/api/settings` | Client-safe settings (secrets masked) |
| PUT | `/api/settings` | Update settings (blank = unset) |
| POST | `/api/settings/test` | Authenticated GitHub probe |
| GET | `/api/metrics` | Aggregate trends across every recorded review |
| GET | `/api/metrics/runs` | The most recent run records, newest first (`?limit=`) |
| GET | `/api/events` | Server-Sent Events stream (agent + review lifecycle) |

## Deployment

A `Dockerfile` and `docker-compose.yml` live at the repository root:

```bash
cp .env.example .env        # GITHUB_TOKEN + a 32+ char WEB_SECRET_KEY
docker compose up --build   # http://127.0.0.1:4000
```

The build runs `mcp-server`'s test suite, so a failing agent never reaches an image.
The compose file binds to loopback deliberately — see the auth TODO below.

## TODOs

- **Auth for multi-user access.** The server still has no auth layer — the assumption
  is you run it locally like the CLI. The compose file binds to `127.0.0.1` for that
  reason; put SSO or basic-auth in front before exposing it.
- ~~**Deployment target.**~~ Done — `Dockerfile` + `docker-compose.yml` at the repo root.
- ~~**Per-agent SSE granularity.**~~ Done — `orchestrator.runReview` now takes optional
  `onAgentStart` / `onAgentDone` callbacks, and `/api/review/:n/run` passes them, so each
  agent flips state when it actually starts and finishes. Both default to no-ops, so the
  CLI and CI paths are unchanged.
