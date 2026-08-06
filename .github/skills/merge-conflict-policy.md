# Skill: merge-conflict-policy

How the Orchestrator resolves the final **Review Decision** row when the three agents
disagree.

## Precedence

Security outranks the other two. Documentation quality never overrides a security block.

| Security | Summary | Documentation | Merged decision |
|---|---|---|---|
| `critical` or `high` | any | any | **REQUEST CHANGES** |
| `medium` | any | `high` | **REQUEST CHANGES** |
| `medium` | any | `medium` or lower | **NEEDS DISCUSSION** |
| `low` or `clean` | any | `high` | **NEEDS DISCUSSION** |
| `low` or `clean` | `high` risk complexity flag | any | **NEEDS DISCUSSION** |
| `clean` | any | `medium` or lower | **APPROVE** |
| Any agent `status: error` | — | — | **NEEDS DISCUSSION** (never auto-approve on partial data) |

## Rules

1. **Any Security finding at `high` or `critical` is a hard block.** Do not
   auto-approve, no matter how good the summary or docs are.
2. **An agent that errored is not "clean".** Treat `status: error` as unknown risk —
   `NEEDS DISCUSSION`, and note the failure in the decision row.
3. **Documentation-only issues never block.** Doc drift, missing docstrings, changelog
   gaps → at most `NEEDS DISCUSSION`.
4. **A Summary with `risk_level: high`** (used to signal unusual complexity or scope) →
   at most `NEEDS DISCUSSION`, never `APPROVE`.
5. **Clean across the board = `APPROVE`.** Not "LGTM", not "Approve pending nits".

## How to render the row

```markdown
## ✅ Review Decision

| Agent | Status | Risk | Findings |
|---|---|---|---|
| 📋 Summary | complete | clean | 0 |
| 🔒 Security | complete | high | 2 |
| 📚 Documentation | complete | low | 1 |

**Decision:** 🟠 **REQUEST CHANGES** — Security agent reported high-severity findings.
```

Always include a one-clause justification after the decision label — never a bare
verdict.
