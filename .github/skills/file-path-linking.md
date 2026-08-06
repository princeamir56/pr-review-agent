# Skill: file-path-linking

How to render file references so the merged report is consistent and navigable.

## The format

- With a line number: `` `src/auth.js:42` ``
- Without a line number (file-level finding): `` `src/auth.js` ``
- Ranges: `` `src/auth.js:42-58` `` — only when the finding truly spans multiple lines.

Always wrap in single backticks. No leading `./`, no repo prefix, no URL.

## Rules

- Use the **filename from `get_pr_data`** verbatim — don't rewrite `src/foo/bar.ts` as
  `bar.ts`.
- The line number is the **new-side** number (see [diff-reading](./diff-reading.md)).
- If the finding lives in the PR description or a commit message, say so explicitly
  (`PR description`, `commit deadbeef`) — do not fake a filename.
- Never say "line 42 of the file above" — the merged report is read out of order.

## Bad → good

| Bad | Good |
|---|---|
| `line 42 of auth.js` | `` `src/auth.js:42` `` |
| `[src/auth.js](src/auth.js#L42)` | `` `src/auth.js:42` `` |
| `auth.js` | `` `src/auth.js` `` |
