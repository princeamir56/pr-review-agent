# Skill: what-not-to-say

Anti-patterns to avoid in the Summary section (and applicable to all agents).

## Never do this

1. **Never restate the PR title.** The reader already saw it above the section.
2. **Never enumerate every file changed.** Diff statistics are already on the GitHub PR
   page. If a specific file is load-bearing, name that one; otherwise silence.
3. **Never praise the author.** "This is a well-written change" wastes a line and is
   noise in a doc that's supposed to help reviewers act.
4. **Never speculate about future PRs.** "The author may plan to also…" is out of scope.
5. **Never explain what the agent is doing.** "I will now summarize…". Just do it.
6. **Never use the phrase *"This PR"*.** Start with the verb: *"Adds…", "Refactors…",
   "Fixes…"*.
7. **Never hedge for no reason.** "This appears to possibly do X" → "Does X".
8. **Never quote large diff blocks back.** Reference `` `path:line` ``.
9. **Never write more than the budget** in [pr-summary-shape](./pr-summary-shape.md).
   If you're over, cut prose, not structure.
10. **Never invent status the report shouldn't dictate.** Do not write
    *"Ready to merge"* or *"Approve"* in the Summary section — the merged Review Decision
    row handles that.

## If the PR is trivial

Say so, short. Example:

> **What.** Bumps `zod` from 3.22.4 to 3.23.0. **Why.** Security fix in changelog.
> **Impact.** None expected; API surface unchanged. **Complexity.** Small — dependency
> bump only.

Ten seconds to write, ten seconds to read. That's the goal.
