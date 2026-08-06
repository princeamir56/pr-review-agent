# Skill: false-positive-guard

Checklist to run before reporting any security finding. Every "yes" allows the finding
to stand; any "no" drops or downgrades it.

## The checklist

1. **Is the pattern on an added (`+`) line?** If it's on a context or removed line, drop
   the finding — the PR isn't introducing it.
2. **Is the file production code?** If it's `**/tests/**`, `*.test.*`, `*.spec.*`,
   `fixtures/`, `mocks/`, `examples/`, `docs/` — dampen severity per
   [severity-scoring](./severity-scoring.md).
3. **Is the value non-synthetic?** Obvious placeholders (`example`, `changeme`, all-X,
   all-0) drop the finding entirely. See [secret-triage](./secret-triage.md).
4. **Is user input actually reachable?** For injection/SSRF/path-traversal rules, check
   the identifier really is `req.*`, `request.*`, `argv`, or a param known to be tainted.
   `req` as a *variable name* for something else (e.g. `const req = new Request(...)`
   built from a constant) is not user input.
5. **Is the pattern already mitigated on the same line?** E.g. a `parameterized(...)`
   wrapper, an explicit `.escape(...)` call, a sanitizer function. If yes, drop.
6. **Is the line suppressed?** `pr-agent-ignore`, `nosec`, `semgrep: ignore` → skip.
7. **Can you name a concrete failure scenario?** If you can't say *"an attacker submits
   X, resulting in Y"*, drop one severity level.

## When to prefer no finding

- If you'd only be repeating what a different rule already reported on the same line
  (e.g. `eval(req.body)` triggering both "eval" and "input-validation"), keep the
  higher-severity one and drop the other.
- If your only evidence is a variable name (`password`, `secret`), and the value is
  clearly a placeholder — no finding.

## When to prefer *keeping* a low-confidence finding

If the finding is `critical` and there's any credible failure scenario, keep it and
mark severity `high` with a note "confirm in production context". A missed critical is
much worse than a demoted one.
