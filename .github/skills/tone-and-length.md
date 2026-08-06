# Skill: tone-and-length

Style guide for every agent's `output_markdown`.

## Voice

- Direct, factual, present tense. "The function reads user input." not "It appears that
  the function may be reading user input."
- No hedging: skip *seems*, *appears*, *possibly*, *might*.
- No filler: skip *In this PR, the author has…*, *It's important to note that…*.
- No self-reference: never say *"I", "the security agent thinks", "as an AI"*.
- No apologies or disclaimers.

## Length

- Findings first, prose last.
- One line per finding. If a finding needs elaboration, one extra indented line for the
  recommendation. That's it.
- No summary paragraph after a bullet list — the list is the summary.
- Section budget: **200 words max**. If you're over, cut prose, keep findings.

## Formatting

- Bullets over paragraphs.
- No emoji spam. The section header may have one (📋 🔒 📚). Findings use the severity
  icon defined by the pipeline (🔴 🟠 🟡 🔵). Nothing else.
- No `###` sub-headers inside a section — use bold labels.
- Never quote back the diff. Reference `` `path:line` `` and describe.

## Bad → good

Bad:
> In this pull request, the author has introduced what appears to be a potentially
> problematic pattern where user input might be used in a database query without
> proper sanitization, which could possibly lead to SQL injection vulnerabilities.

Good:
> - 🟠 High — `src/db.js:22` — [sql] SQL query built from `req.body.name`.
>   *Recommendation:* Use parameterized queries.
