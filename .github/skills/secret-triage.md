# Skill: secret-triage

How to decide whether a string that *looks like* a secret is one.

## Real vs fixture — decision order

1. **Provider-format regex** hits (GitHub `ghp_*`, AWS `AKIA*`, Stripe `sk_live_*`, Google
   `AIza*`, Slack `xox[baprs]-*`, RSA/PGP `-----BEGIN … PRIVATE KEY-----`, JWT
   `eyJ*.*.*`) → **treat as real** unless step 2 clearly rules it out.
2. **Placeholder tokens** — instant drop:
   `changeme`, `example`, `dummy`, `placeholder`, `your-…`, `xxxxx`, `<TOKEN>`, all-`0`,
   all-`X`, or repeating patterns like `abcabcabc`.
3. **File location** — a fixture in `**/tests/**`, `**/__tests__/**`,
   `*.test.*`, `*.spec.*`, or a `fixtures/` folder: dampen one severity level (see
   [severity-scoring](./severity-scoring.md)).
4. **Entropy** — for values with no provider prefix, compute Shannon entropy over the
   literal:
   - ≥ 4.0 bits/char + assigned to an identifier like `token`/`secret`/`api_key`/
     `password`/`access_key` → flag as generic high-entropy secret.
   - < 4.0 → probably not a secret (English words, hex counters, etc.).
5. **Inline suppression** — line contains `pr-agent-ignore`, `nosec`, or
   `semgrep: ignore`: skip entirely.

## What to write

- Always name the provider when you know it: *"Stripe live key"*, *"AWS access key ID"*.
- Never quote the secret value back in the report — reference `` `path:line` `` only.
- Recommendation should always include **rotate** (not just "remove"), because the value
  is already in git history the moment you see it.

## Common false positives

- Base64-looking config data that isn't a credential (asset hashes, cache keys).
- Test JWTs with obvious payloads (`{"sub":"test"}`).
- Base32/hex UUIDs.

If uncertain, prefer flagging with severity `medium` and asking the reviewer to confirm.
