# Skill: readme-drift

Catch documentation that goes out of sync with the code. Run whenever a PR changes
public API, CLI, env vars, or config.

## Signals the Documentation agent should watch for

1. **Public API changes** — a function/class/route added, removed, or with a changed
   signature in an exported module (barrel file, `index.ts`, `__init__.py`).
2. **CLI changes** — new/removed subcommand, changed arg parsing (`cli.ts`, `argparse`,
   `click`, `yargs`).
3. **Env var changes** — new/renamed/removed env vars in code that don't appear in
   `.env.example` or in the README's env var table.
4. **Config schema changes** — `settings.json`, `mcp.json`, `tasks.json`, or any config
   file the README documents by field.
5. **File paths in README that don't exist anymore** — e.g. README references
   `src/foo.ts` but the PR moved it to `src/foo/index.ts`.

## What to produce

For each drift, output:

- A `` `path:line` `` reference to the README (or other doc) location that's stale.
- A **ready-to-paste diff** showing the exact fix. Use fenced ` ```diff ` blocks.

Example:

```diff
- | `MCP_SERVER_PORT` | optional | Default 3000 |
+ | `MCP_SERVER_PORT` | (unused; stdio transport) | — |
```

## What not to do

- Do not propose sweeping rewrites of README sections. Point at the exact line, propose
  the exact edit.
- Do not flag stylistic differences (heading capitalisation, oxford commas). Only
  factual drift.
- Do not require a README update for internal renames — only when the README references
  the renamed symbol.

## When there is no drift

Silence. Do not write *"No documentation drift found"* — a clean report is better.
