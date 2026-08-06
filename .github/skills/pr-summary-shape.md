# Skill: pr-summary-shape

The exact structure the Summary agent's `output_markdown` must follow.

## Template

```markdown
## 📋 Summary

**What.** <one sentence describing the change, ≤30 words>

**Why.** <one sentence on motivation / linked issue / user pain, ≤30 words>

**Impact.** <what code/behavior changes for callers, users, or operators, ≤40 words>

**Complexity.** <Small | Medium | Large | XL — see complexity-heuristics — with one
justification clause, ≤20 words>
```

## Rules

- Four labels, always in this order. Bold the label, period after it.
- No sub-headers, no bullet lists inside these fields. Prose only.
- Hard budget: **120 words total.** If you're over, cut Impact first, then Why.
- If the PR body is empty or unclear, infer Why from the diff — never write *"unclear"*
  or *"the author did not explain"*.
- If nothing meaningful changes for callers, Impact = `Internal refactor only. No public
  behavior changes.` Done.

## What to skip

- Do not restate the PR title.
- Do not list every file changed.
- Do not congratulate the author.
- Do not say *"This PR"* — start with the verb (*"Adds…", "Refactors…"*).

## Example

```markdown
## 📋 Summary

**What.** Adds an entropy-based generic secret detector to the Security agent.

**Why.** Regex-only detection missed provider tokens the ruleset didn't know about; the
review missed a leaked Slack webhook last week.

**Impact.** Any literal ≥20 chars assigned to a secret-shaped identifier is scored;
≥4.0 bits/char flags a finding. Placeholders are still ignored.

**Complexity.** Small — one new function, no wiring changes.
```
