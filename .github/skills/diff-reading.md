# Skill: diff-reading

Reusable guidance for reading unified-diff patches. Include in any agent that reasons over
`get_pr_data` output.

## Patch structure

- Hunks start with `@@ -oldStart,oldCount +newStart,newCount @@`.
- `+lines` are additions on the **new** side. `-lines` are removals on the **old** side.
- Unprefixed lines are context (present on both sides).
- `+++` / `---` are file headers, not code.

## Resolving `path:line`

Track the **new-side line counter** (`newStart` from the hunk header). Every `+` and every
context line advances it by 1. `-` lines do **not** advance it. Report the counter's
current value when you flag a `+` line.

```
@@ -14,3 +14,4 @@
 context line       ← line 14
-removed line       ← does NOT advance counter
+added line A       ← line 15  (report this)
+added line B       ← line 16
 context line       ← line 17
```

## Rules

- **Only report added lines** (`+`). Do not flag lines the PR removed — they're gone.
- Skip patches with `filename` matching lockfiles or minified bundles
  (`package-lock.json`, `*.min.js`, `*.map`, `*.snap`).
- If `patch` is empty (binary file, or file too large), say so — don't invent findings.
- A line without a preceding hunk header has no valid line number; report it as
  `` `path` `` (no colon).
