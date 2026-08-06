# Skill: changelog-format

How to write changelog entries the Documentation agent proposes. Follows [Keep a
Changelog](https://keepachangelog.com/) conventions, matching the README's existing
Updates section.

## Section headers

Exactly these, in this order, only if the change actually needs them:

```
### YYYY-MM-DD — <one-line theme>

**Added**
- …

**Changed**
- …

**Fixed**
- …

**Removed**
- …

**Security**
- …
```

- Date is the day the PR merges (use today's date when drafting).
- The theme is 4–10 words summarizing the whole entry — not the PR title.
- Drop any section that has no entries. Don't leave empty **Added**.

## Entry rules

- **Imperative, past-tense narrative.** *"Added X"*, *"Fixed Y"*. Not *"This PR adds"*,
  not *"Will add"*.
- One line per entry, wrapped at ~ 100 chars. Multi-line only when a bullet needs a
  code fence or a short justification.
- **Bold the lead noun/verb** to make scanning easy:
  `**Entropy-based generic secret detector** in the Security agent.`
- **No PR / issue numbers** in the entry text — the git log carries those.
- **No author names** — the git log carries those too.
- **User-visible only.** Refactors that don't change behavior go in the git log, not the
  changelog.

## What goes where

| Change type | Section |
|---|---|
| New feature, new file, new tool, new command | Added |
| Behavior change to an existing feature, config default flip | Changed |
| Bug fix | Fixed |
| Deleted feature/command/file | Removed |
| CVE fix, secret rotation, vulnerability closed | Security |

## Example

```markdown
### 2026-07-04 — Advanced Security agent

**Added**
- **9 new vulnerability categories** in the Security agent (path-traversal, ssrf, …).
- **Entropy-based generic secret detection** — Shannon entropy ≥ 4.0 bits/char on
  secret-shaped identifiers.

**Changed**
- Dedupe key now includes `issue`, so distinct rules on the same line don't collapse.
```
