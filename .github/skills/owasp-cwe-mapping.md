# Skill: owasp-cwe-mapping

Tag each security finding with a **CWE ID** and an **OWASP Top 10 (2021)** category.
Consistent tagging lets downstream tools bucket findings.

## Reference table (most common in this project's stack)

| Category (project) | CWE | OWASP 2021 | Trigger |
|---|---|---|---|
| secrets | CWE-798 | A07 Identification & Auth Failures | Hardcoded credentials |
| injection (shell) | CWE-78 | A03 Injection | `exec("cmd " + input)` |
| injection (code) | CWE-95 | A03 Injection | `eval`, `new Function`, `vm.runIn*` |
| sql | CWE-89 | A03 Injection | Concatenated SQL |
| xss | CWE-79 | A03 Injection | Unescaped HTML sink |
| ssrf | CWE-918 | A10 SSRF | Outbound request to user-controlled URL |
| path-traversal | CWE-22 | A01 Broken Access Control | `fs.readFile(path.join(input))` |
| deserialization | CWE-502 | A08 Software & Data Integrity Failures | `pickle.loads`, `yaml.load` |
| crypto (weak hash) | CWE-327 | A02 Cryptographic Failures | MD5, SHA1 |
| crypto (weak PRNG) | CWE-338 | A02 Cryptographic Failures | `Math.random()` for token |
| crypto (hardcoded key/IV) | CWE-329 | A02 Cryptographic Failures | Hardcoded IV |
| open-redirect | CWE-601 | A01 Broken Access Control | `res.redirect(req.*)` |
| tls | CWE-295 | A02 Cryptographic Failures | `rejectUnauthorized: false` |
| tls (plaintext) | CWE-319 | A02 Cryptographic Failures | `http://` for remote |
| cookie | CWE-1004 | A05 Security Misconfiguration | Missing `httpOnly` |
| cors/csp | CWE-942 / CWE-1021 | A05 Security Misconfiguration | `*` origin, `unsafe-inline` |
| auth stubbed | CWE-306 | A07 | `return true` in auth middleware |
| jwt alg none | CWE-327 | A02 | `algorithm: "none"` |
| prototype-pollution | CWE-1321 | A08 | `__proto__` writes |
| header-injection | CWE-113 | A03 | `setHeader(name, req.*)` |
| input-validation | CWE-20 | A04 Insecure Design | `req.body` used without schema |
| hardcoded IP | CWE-547 | A05 | Private IP in source |
| debug flag | CWE-489 | A05 | `DEBUG=true` committed |
| dependencies | — | A06 Vulnerable Components | Manifest changed |

## How to render

Append the CWE tag in the finding line, inline with the category:

```
- 🟠 High — `src/db.js:22` — [sql] [CWE-89] SQL query built from `req.body.name`.
```

Do not add OWASP tags in the finding line (too noisy) — use them only if the reviewer
explicitly asks for a categorized summary.
