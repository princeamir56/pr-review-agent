# Skill: severity-scoring

Rubric for picking a severity for a security finding. Aligns with the deterministic
`securityAgent.ts` rules.

## Levels

| Level | Meaning | Examples |
|---|---|---|
| 🔴 **critical** | Remote code execution, secret leak in prod path, complete auth bypass, insecure deserialization of untrusted input | Committed `ghp_*` / `AKIA*` / private key, `pickle.loads(req.body)`, hardcoded prod DB password |
| 🟠 **high** | Injection, broken cryptography, XSS, SSRF, path traversal, TLS disabled | Concatenated SQL with `req.*`, `eval(userInput)`, `dangerouslySetInnerHTML`, `rejectUnauthorized: false`, `res.redirect(req.*)` |
| 🟡 **medium** | Missing input validation, weak defaults, dynamic code that isn't clearly reachable from user input, MD5 for non-password hashing | Raw `req.body` used without a schema, `unsafe-inline` CSP, `Math.random()` for a token |
| 🔵 **low** | Hygiene, informational, non-exploitable smells | `DEBUG=true` in committed code, dependency manifest changed |

## Applying it

1. Start from the rule's default severity.
2. **Dampen for test files** (`**/tests/**`, `**/__tests__/**`, `*.test.*`, `*.spec.*`):
   critical → high, high → medium, medium → low, low → low.
3. **Boost** by one level if the finding sits on a production entry point
   (route handler, exported API, CLI arg parser) *and* touches user input.
4. Never raise a rule above `critical` or drop below `low`.

## Aggregating

The section's overall `risk_level` = the highest severity of any finding, mapped:
`critical → critical`, `high → high`, `medium → medium`, `low → low`, no findings → `clean`.

## When in doubt

- If you can't articulate a concrete failure scenario, drop one level.
- If the pattern is only reachable from admin-only paths, drop one level.
- If uncertain between two levels, pick the **lower** one — false-high findings train
  reviewers to ignore the section.
