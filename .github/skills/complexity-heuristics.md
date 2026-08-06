# Skill: complexity-heuristics

How to score PR complexity for the Summary section.

## Bands

| Band | Signals |
|---|---|
| **Small** | ≤ 50 LOC changed, ≤ 3 files, no cross-module impact, no new dependencies, no migrations |
| **Medium** | 50–300 LOC, ≤ 10 files, ≤ 1 module boundary crossed, may add 1 dependency |
| **Large** | 300–1000 LOC, or ≥ 2 module boundaries, or new dependency + code, or a schema change |
| **XL** | > 1000 LOC, or database migration, or breaking API change, or > 20 files, or > 1 new dependency |

## Inputs to look at

- `context.files.length` and cumulative `additions + deletions`.
- Whether any dependency manifest changed (`package.json`, `requirements.txt`, `go.mod`, etc.).
- Whether migrations/schema files changed (`migrations/`, `*.sql`, `schema.prisma`, `alembic/`).
- Whether any public export or route signature changed.

## Escalation rules

Anything below auto-lifts the band by one step (Small → Medium, Medium → Large, etc.):

- New dependency added.
- Any file in `migrations/` or `.sql`.
- Any change to a public exported symbol's signature.
- Any file under `.github/workflows/` or CI config changes.

## What to write

Just the band + one clause of justification:

- ✅ `Small — one new function, no wiring changes.`
- ✅ `Medium — new dependency (zod), schema validation added across 4 handlers.`
- ✅ `XL — Postgres migration + breaking API change to /users.`

Never leave the reader guessing why you picked the band.
