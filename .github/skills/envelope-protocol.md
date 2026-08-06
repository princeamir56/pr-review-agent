# Skill: envelope-protocol

Canonical shape of the JSON envelope every specialist agent returns to the orchestrator.

## Schema

```json
{
  "agent": "summary | security | documentation",
  "pr_number": 42,
  "status": "complete | error | skipped",
  "risk_level": "clean | low | medium | high | critical",
  "output_markdown": "## Section\n...",
  "findings_count": 0,
  "processing_time_ms": 1200
}
```

## Field rules

- **`agent`** — exact string, lowercase, one of the three.
- **`pr_number`** — integer, same as the input.
- **`status`**
  - `complete` — analysis ran end-to-end.
  - `error` — the agent could not run (missing input, tool failure). Set `findings_count: 0`
    and put the error explanation in `output_markdown`.
  - `skipped` — intentionally not applicable (e.g. PR touches no code files).
- **`risk_level`**
  - Summary/Documentation return `clean` unless they surface a real risk.
  - Security uses the [severity-scoring](./severity-scoring.md) rubric.
  - `critical > high > medium > low > clean`. The merge picks the highest.
- **`output_markdown`** — the section that will be pasted into the merged report. Must start
  with the section header (`## 📋 Summary`, `## 🔒 Security Analysis`, `## 📚 Documentation`).
- **`findings_count`** — number of distinct items reported (not lines). Zero on `clean`.
- **`processing_time_ms`** — wall-clock ms; report an integer.

## What not to do

- Do not add fields the schema doesn't list.
- Do not return prose outside the envelope — the orchestrator only reads the JSON.
- Do not embed the envelope inside `output_markdown`.
