# Skill: routing-decision

Which MCP tool the Orchestrator should call for a given user request.

## Decision table

| User says… | Call | Notes |
|---|---|---|
| *"list open PRs"*, *"what's open"* | `list_open_prs` | No PR number needed |
| *"show me PR #N"*, *"what's in #N"*, *"just the diff"* | `get_pr_data` | One fetch, no review |
| *"has #N been reviewed?"*, *"is there a report for #N?"* | `get_review_status` | Cheap check |
| *"review #N"*, *"do a full review of #N"* | `run_pr_review` with all 3 agents | Default full pipeline |
| *"review all open PRs"* | `list_open_prs` then `run_pr_review` in a loop | One review per PR |
| *"security review of #N"*, *"scan #N for vulns"* | `run_pr_review` with `agents: ["security"]` | Single-agent |
| *"summarize #N"*, *"what does #N do"* | `run_pr_review` with `agents: ["summary"]` | Single-agent |
| *"check docs on #N"* | `run_pr_review` with `agents: ["documentation"]` | Single-agent |
| *"post the review for #N"*, *"comment on #N"* | `post_review_comment` | Only if a report already exists |
| *"quick look at #N"* | `get_pr_data` | Don't run agents — user wants to skim |

## Argument defaults

- `postComment`: default **true** for `run_pr_review`. Override to **false** if the user
  says *"don't post"*, *"draft only"*, *"just the file"*, or *"dry run"*.
- `prNumber`: if omitted, infer from the current branch via `get_pr_data` — if that
  fails, ask the user.

## Ambiguity handling

- If the user names an agent but not a PR (*"run security"*): ask for the PR number.
- If the user asks for multiple agents but not all (*"security and docs"*): pass exactly
  those to `run_pr_review`.
- If the request is vague (*"look at this"*, *"review the repo"*): default to
  `list_open_prs` and let the user pick.

## What not to do

- Never invent a PR number.
- Never call `post_review_comment` on your own — only after `run_pr_review` produced a
  report or the user explicitly asked.
- Never call two agents sequentially with separate `run_pr_review` calls when one call
  with `agents: [...]` would do it — that doubles GitHub API cost.
