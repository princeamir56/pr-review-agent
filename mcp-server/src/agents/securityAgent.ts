import { AgentEnvelope, Finding, PRContext, RiskLevel, Severity, highestRisk, parseAddedLines } from "./types";
import { readSarifFindings, SarifIngestResult } from "./sarif";

interface Rule {
  category: string;
  severity: Severity;
  pattern: RegExp;
  issue: string;
  recommendation: string;
  cwe?: string;
}

const SEVERITY_ICON: Record<Severity, string> = {
  critical: "🔴 Critical",
  high: "🟠 High",
  medium: "🟡 Medium",
  low: "🔵 Low"
};

const SEVERITY_TO_RISK: Record<Severity, RiskLevel> = {
  critical: "critical",
  high: "high",
  medium: "medium",
  low: "low"
};

const SEVERITY_ORDER: Record<Severity, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3
};

const CATEGORIES = [
  "secrets",
  "injection",
  "auth",
  "dependencies",
  "hardcoded",
  "input-validation",
  "sql",
  "xss",
  "cors/csp",
  "path-traversal",
  "ssrf",
  "deserialization",
  "crypto",
  "open-redirect",
  "cookie",
  "tls",
  "prototype-pollution",
  "header-injection"
] as const;

/**
 * Pattern-based security rules, informed by Semgrep/gitleaks/OWASP taxonomies.
 * High-precision by design — false positives here become PR-review noise.
 */
const RULES: Rule[] = [
  // --- secrets / credentials ---
  {
    category: "secrets",
    severity: "critical",
    pattern: /\bghp_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b|\bgho_[A-Za-z0-9]{20,}\b|\bghs_[A-Za-z0-9]{20,}\b/,
    issue: "GitHub token committed to source.",
    recommendation: "Remove the token, load it from an environment variable, and revoke the exposed token.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "critical",
    pattern: /\bsk-(?:ant-)?[A-Za-z0-9_-]{20,}\b/,
    issue: "API secret key (OpenAI/Anthropic style) committed to source.",
    recommendation: "Move the key to an environment variable and rotate the exposed key.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "critical",
    pattern: /\bAKIA[0-9A-Z]{16}\b/,
    issue: "AWS access key ID committed to source.",
    recommendation: "Remove the key, use IAM roles or env vars, and rotate the credential.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "critical",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/,
    issue: "Google API key committed to source.",
    recommendation: "Remove the key, restrict it in the GCP console, and rotate.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "critical",
    pattern: /\b(?:sk|rk|pk)_live_[0-9a-zA-Z]{24,}\b/,
    issue: "Stripe live API key committed to source.",
    recommendation: "Remove the key immediately and rotate it in the Stripe dashboard.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "high",
    pattern: /https:\/\/hooks\.slack\.com\/services\/T[A-Za-z0-9]+\/B[A-Za-z0-9]+\/[A-Za-z0-9_]+/,
    issue: "Slack incoming webhook URL committed to source.",
    recommendation: "Rotate the webhook and load it from configuration.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "high",
    pattern: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/,
    issue: "Slack API token committed to source.",
    recommendation: "Revoke the token in Slack and load it from an environment variable.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "high",
    pattern: /\bSG\.[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}\b/,
    issue: "SendGrid API key committed to source.",
    recommendation: "Rotate the SendGrid key and store it in an env var.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "high",
    pattern: /\bAC[a-f0-9]{32}\b|\bSK[a-f0-9]{32}\b/,
    issue: "Twilio account SID / API key committed to source.",
    recommendation: "Rotate the credential in the Twilio console and use env vars.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "high",
    pattern: /DefaultEndpointsProtocol=https?;AccountName=[^;]+;AccountKey=[^;"'\s]+/i,
    issue: "Azure Storage connection string with account key committed to source.",
    recommendation: "Rotate the account key and use Managed Identity or an env var.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "high",
    pattern: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
    issue: "JWT token committed to source.",
    recommendation: "Do not commit real JWTs. If this is a fixture, mark it clearly and use an obviously fake payload.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "critical",
    pattern: /-----BEGIN (?:RSA |EC |OPENSSH |DSA |PGP )?PRIVATE KEY-----/,
    issue: "Private key material committed to source.",
    recommendation: "Remove the key from the repo and rotate it; store keys in a secret manager.",
    cwe: "CWE-798"
  },
  {
    category: "secrets",
    severity: "high",
    pattern: /\b(?:password|passwd|secret|api[_-]?key|token|access[_-]?key)\s*[:=]\s*["'][^"'\s]{6,}["']/i,
    issue: "Hardcoded credential assigned in source.",
    recommendation: "Load the value from configuration or an environment variable instead of hardcoding it.",
    cwe: "CWE-798"
  },

  // --- injection ---
  {
    category: "injection",
    severity: "high",
    pattern: /\beval\s*\(/,
    issue: "Use of eval() can execute arbitrary code.",
    recommendation: "Avoid eval(); parse data explicitly or use a safe alternative.",
    cwe: "CWE-95"
  },
  {
    category: "injection",
    severity: "high",
    pattern: /\b(?:child_process\.)?exec(?:Sync)?\s*\(\s*[`"'].*\$\{/,
    issue: "Shell command built with interpolated input may allow command injection.",
    recommendation: "Use execFile with an argument array, or strictly validate/escape inputs.",
    cwe: "CWE-78"
  },
  {
    category: "injection",
    severity: "high",
    pattern: /\bos\.system\s*\(|subprocess\.(?:call|run|Popen)\s*\([^)]*shell\s*=\s*True/,
    issue: "Python shell execution with shell=True or os.system enables command injection.",
    recommendation: "Use subprocess with a list argv and shell=False; validate any user input.",
    cwe: "CWE-78"
  },
  {
    category: "injection",
    severity: "medium",
    pattern: /new\s+Function\s*\(|require\s*\(\s*(?:req\.|input|params)/,
    issue: "Dynamic code / dynamic require can execute arbitrary code.",
    recommendation: "Replace dynamic code generation with explicit logic; never require() from user input.",
    cwe: "CWE-95"
  },
  {
    category: "injection",
    severity: "medium",
    pattern: /\bvm\.(?:runInNewContext|runInThisContext|runInContext)\s*\(/,
    issue: "Node vm module is not a security sandbox; can be escaped from untrusted code.",
    recommendation: "Do not use vm for isolating untrusted code; use an OS-level sandbox.",
    cwe: "CWE-95"
  },

  // --- xss ---
  {
    category: "xss",
    severity: "high",
    pattern: /dangerouslySetInnerHTML|\.innerHTML\s*=|\.outerHTML\s*=/,
    issue: "Unescaped HTML assignment is an XSS vector.",
    recommendation: "Render text safely or sanitize HTML with a vetted sanitizer (e.g. DOMPurify).",
    cwe: "CWE-79"
  },
  {
    category: "xss",
    severity: "medium",
    pattern: /document\.write\s*\(|\.insertAdjacentHTML\s*\(/,
    issue: "document.write / insertAdjacentHTML with dynamic content can introduce XSS.",
    recommendation: "Build DOM nodes via safe APIs (textContent, createElement).",
    cwe: "CWE-79"
  },

  // --- sql / nosql ---
  {
    category: "sql",
    severity: "high",
    pattern: /(?:SELECT|INSERT|UPDATE|DELETE)\b[\s\S]*(?:\+|\$\{|`).*(?:req\.|input|params|query|body)/i,
    issue: "SQL query appears to be built by concatenating user input.",
    recommendation: "Use parameterized queries / prepared statements.",
    cwe: "CWE-89"
  },
  {
    category: "sql",
    severity: "medium",
    pattern: /\$where\s*:/,
    issue: "MongoDB $where with dynamic input enables NoSQL/JS injection.",
    recommendation: "Avoid $where; use typed query operators and validated inputs.",
    cwe: "CWE-943"
  },

  // --- cors / csp ---
  {
    category: "cors/csp",
    severity: "high",
    pattern: /Access-Control-Allow-Origin["'\s:=,()]+\*/i,
    issue: "CORS allows any origin (`*`), exposing authenticated endpoints.",
    recommendation: "Restrict allowed origins to a known allowlist.",
    cwe: "CWE-942"
  },
  {
    category: "cors/csp",
    severity: "medium",
    pattern: /unsafe-inline|unsafe-eval/i,
    issue: "Content-Security-Policy weakened with unsafe-inline/unsafe-eval.",
    recommendation: "Remove unsafe-* directives; use nonces/hashes for inline content.",
    cwe: "CWE-1021"
  },

  // --- auth / authz ---
  {
    category: "auth",
    severity: "high",
    pattern: /\b(?:authReq|requireAuth|isAuthenticated|verifyToken|checkAuth|ensureAdmin)\b[\s\S]{0,40}(?:\/\/|=\s*false|return\s+true)/i,
    issue: "Authentication/authorization check appears disabled or stubbed.",
    recommendation: "Confirm the auth gate is intentional and still enforced in production.",
    cwe: "CWE-306"
  },
  {
    category: "auth",
    severity: "high",
    pattern: /jwt\.(?:sign|verify)\([\s\S]*(?:algorithm[s]?\s*:\s*\[?\s*["']none["'])/i,
    issue: "JWT configured with the 'none' algorithm disables signature verification.",
    recommendation: "Use a strong signing algorithm (e.g. RS256/HS256) and never accept 'none'.",
    cwe: "CWE-327"
  },
  {
    category: "auth",
    severity: "medium",
    pattern: /jwt\.verify\([^,]+,[^,)]+\)(?!\s*,)/,
    issue: "jwt.verify called without an explicit algorithms option.",
    recommendation: "Pass { algorithms: ['RS256'] } (or your chosen algorithm) to jwt.verify.",
    cwe: "CWE-327"
  },

  // --- hardcoded values ---
  {
    category: "hardcoded",
    severity: "medium",
    pattern: /\b(?:https?:\/\/)?(?:10\.\d+\.\d+\.\d+|192\.168\.\d+\.\d+|172\.(?:1[6-9]|2\d|3[01])\.\d+\.\d+)\b/,
    issue: "Hardcoded internal/private IP address.",
    recommendation: "Move host configuration to environment variables.",
    cwe: "CWE-547"
  },
  {
    category: "hardcoded",
    severity: "low",
    pattern: /\b(?:DEBUG|VERBOSE)\s*[:=]\s*(?:true|1)\b/i,
    issue: "Debug/verbose flag enabled in committed code.",
    recommendation: "Disable debug output in production builds.",
    cwe: "CWE-489"
  },

  // --- input validation ---
  {
    category: "input-validation",
    severity: "medium",
    pattern: /\b(?:req\.(?:body|query|params)|request\.(?:body|query|args))\b/,
    issue: "User-controlled input is used; verify it is validated/sanitized before use.",
    recommendation: "Validate and type-check request input (e.g. with a schema) before trusting it.",
    cwe: "CWE-20"
  },

  // --- path traversal ---
  {
    category: "path-traversal",
    severity: "high",
    pattern: /(?:fs\.(?:readFile|readFileSync|createReadStream|writeFile|writeFileSync|unlink)|path\.join|path\.resolve)\s*\([^)]*(?:req\.(?:body|query|params)|request\.(?:body|query|args))/,
    issue: "Filesystem path built from user input can lead to path traversal.",
    recommendation: "Normalize with path.resolve, then verify the result is within an allowed base directory.",
    cwe: "CWE-22"
  },
  {
    category: "path-traversal",
    severity: "medium",
    pattern: /\.\.[/\\](?:\.\.[/\\]){1,}/,
    issue: "Explicit `../../` traversal fragment in code.",
    recommendation: "Avoid relative traversal; use a stable base directory and validate paths.",
    cwe: "CWE-22"
  },

  // --- ssrf ---
  {
    category: "ssrf",
    severity: "high",
    pattern: /(?:fetch|axios(?:\.(?:get|post|put|delete|request))?|http\.get|https\.get|request)\s*\(\s*(?:req\.(?:body|query|params)|request\.(?:body|query|args))/,
    issue: "Outbound HTTP call target taken directly from user input (SSRF risk).",
    recommendation: "Validate the URL against an allowlist and block private/link-local ranges (169.254.169.254, 10/8, 127/8).",
    cwe: "CWE-918"
  },

  // --- insecure deserialization ---
  {
    category: "deserialization",
    severity: "high",
    pattern: /\byaml\.load\s*\(/,
    issue: "yaml.load() (PyYAML default) can construct arbitrary Python objects.",
    recommendation: "Use yaml.safe_load() or specify SafeLoader.",
    cwe: "CWE-502"
  },
  {
    category: "deserialization",
    severity: "critical",
    pattern: /\bpickle\.loads?\s*\(|\bcPickle\.loads?\s*\(|\bmarshal\.loads\s*\(/,
    issue: "pickle/marshal deserialization of untrusted data allows arbitrary code execution.",
    recommendation: "Use a safe format (JSON) or sign+verify the payload before unpickling.",
    cwe: "CWE-502"
  },
  {
    category: "deserialization",
    severity: "medium",
    pattern: /node-serialize|serialize-javascript.*unsafe/,
    issue: "Use of node-serialize / unsafe serialize-javascript enables RCE via crafted payloads.",
    recommendation: "Replace with JSON serialization or a hardened alternative.",
    cwe: "CWE-502"
  },

  // --- weak crypto ---
  {
    category: "crypto",
    severity: "high",
    pattern: /createHash\s*\(\s*["'](?:md5|sha1)["']\s*\)|hashlib\.(?:md5|sha1)\s*\(/,
    issue: "Weak hash algorithm (MD5/SHA1) used.",
    recommendation: "Use SHA-256 or better; for passwords use bcrypt/argon2/scrypt.",
    cwe: "CWE-327"
  },
  {
    category: "crypto",
    severity: "high",
    pattern: /createCipher(?:iv)?\s*\(\s*["'](?:des|rc4|des-ecb|aes-\d+-ecb)["']/i,
    issue: "Weak or ECB-mode cipher used.",
    recommendation: "Use AES-GCM (or AES-CBC with HMAC) with a random IV.",
    cwe: "CWE-327"
  },
  {
    category: "crypto",
    severity: "medium",
    pattern: /Math\.random\s*\(\s*\)[\s\S]{0,40}(?:token|secret|password|key|nonce|salt)/i,
    issue: "Math.random() used to generate a security-sensitive value.",
    recommendation: "Use crypto.randomBytes / crypto.randomUUID or the WebCrypto API.",
    cwe: "CWE-338"
  },
  {
    category: "crypto",
    severity: "medium",
    pattern: /\bcrypto\.createCipheriv\s*\([^)]*Buffer\.(?:from|alloc)\s*\(\s*["'][A-Za-z0-9+/=]+["']/,
    issue: "Hardcoded IV/key passed to createCipheriv.",
    recommendation: "Generate a fresh random IV for each encryption and load keys from a KMS/env.",
    cwe: "CWE-329"
  },

  // --- open redirect ---
  {
    category: "open-redirect",
    severity: "high",
    pattern: /res\.redirect\s*\(\s*(?:req\.(?:body|query|params)|request\.(?:body|query|args))/,
    issue: "res.redirect target taken directly from user input (open redirect).",
    recommendation: "Validate the target against an allowlist of internal paths/hosts.",
    cwe: "CWE-601"
  },

  // --- cookies ---
  {
    category: "cookie",
    severity: "medium",
    // The lookahead sits immediately after the opening paren so it inspects the
    // call's own arguments. Placed after the closing paren it inspected whatever
    // followed the call instead, so every res.cookie(...) matched — including
    // correctly hardened ones.
    pattern: /res\.cookie\s*\((?![^)]*httpOnly)/,
    issue: "Cookie set without an explicit httpOnly flag.",
    recommendation: "Set { httpOnly: true, secure: true, sameSite: 'lax' } on session cookies.",
    cwe: "CWE-1004"
  },

  // --- tls / transport ---
  {
    category: "tls",
    severity: "high",
    pattern: /rejectUnauthorized\s*:\s*false|NODE_TLS_REJECT_UNAUTHORIZED\s*=\s*["']?0/,
    issue: "TLS certificate verification disabled.",
    recommendation: "Never disable TLS verification in production; fix the trust chain instead.",
    cwe: "CWE-295"
  },
  {
    category: "tls",
    severity: "medium",
    pattern: /verify\s*=\s*False/,
    issue: "requests(..., verify=False) disables TLS certificate verification.",
    recommendation: "Leave verify=True; add the CA to the trust store if needed.",
    cwe: "CWE-295"
  },
  {
    category: "tls",
    severity: "low",
    pattern: /["']http:\/\/(?!localhost|127\.0\.0\.1|0\.0\.0\.0|example\.)/,
    issue: "Non-TLS http:// URL used for a remote endpoint.",
    recommendation: "Use https:// for any external endpoint.",
    cwe: "CWE-319"
  },

  // --- prototype pollution ---
  {
    category: "prototype-pollution",
    severity: "high",
    pattern: /\[["']__proto__["']\]|\[["']constructor["']\]\[["']prototype["']\]/,
    issue: "Assignment to __proto__ / constructor.prototype enables prototype pollution.",
    recommendation: "Reject keys __proto__/constructor/prototype in merge/assign functions.",
    cwe: "CWE-1321"
  },
  {
    category: "prototype-pollution",
    severity: "medium",
    pattern: /Object\.assign\s*\(\s*\{\s*\}\s*,\s*(?:req\.(?:body|query|params)|request\.(?:body|query|args))/,
    issue: "Object.assign target populated directly from user input.",
    recommendation: "Copy only known allowed keys instead of assigning the whole payload.",
    cwe: "CWE-1321"
  },

  // --- header injection / CRLF ---
  {
    category: "header-injection",
    severity: "medium",
    pattern: /(?:setHeader|res\.header|response\.headers\[)[^;]*(?:req\.(?:body|query|params)|request\.(?:body|query|args))/,
    issue: "HTTP response header value built from user input (CRLF injection risk).",
    recommendation: "Strip \\r/\\n from user-provided header values or reject them.",
    cwe: "CWE-113"
  }
];

/**
 * Detect high-entropy string literals assigned to secret-shaped identifiers.
 * This is the "skill" that catches provider tokens we don't have a regex for.
 */
const ENTROPY_ASSIGN = /\b(secret|token|api[_-]?key|access[_-]?key|password|passwd|private[_-]?key)\b\s*[:=]\s*["']([A-Za-z0-9+/=_-]{20,})["']/i;
const ENTROPY_THRESHOLD = 4.0;

/**
 * Comment-based suppression: any line containing `pr-agent-ignore` or `nosec`
 * disables all rule matches on that line. Same convention as bandit/semgrep.
 */
const SUPPRESSION = /(?:pr-agent-ignore|nosec|semgrep:\s*ignore)/i;

const TEST_FILE = /(?:^|[/\\])(?:tests?|__tests__|spec)[/\\]|\.(?:test|spec)\.[a-z]+$/i;

const FILE_SKIP = /(?:package-lock\.json|pnpm-lock\.yaml|yarn\.lock|\.min\.js|\.map|\.snap)$/i;

/**
 * Deterministic Security agent. Scans every added line in the PR diff against the
 * rule set, adds an entropy-based generic secret check, respects inline
 * suppressions, and dampens severity in test files.
 *
 * When external scanners (Semgrep/Gitleaks/Trivy) have written `*.sarif` files into
 * the workspace (`cwd`, or `PR_AGENT_SARIF_DIR`), their findings are folded into the
 * same section so the PR gets one unified security report. If no SARIF is present,
 * behavior is identical to the regex-only agent.
 */
export function runSecurityAgent(context: PRContext, cwd: string = process.cwd()): AgentEnvelope {
  const start = Date.now();
  const findings: Finding[] = [];
  const triggeredCategories = new Set<string>();

  for (const file of context.files) {
    if (FILE_SKIP.test(file.filename)) {
      continue;
    }
    const inTest = TEST_FILE.test(file.filename);

    for (const { line, content } of parseAddedLines(file.patch)) {
      if (SUPPRESSION.test(content)) {
        continue;
      }

      for (const rule of RULES) {
        if (rule.pattern.test(content)) {
          findings.push({
            severity: dampen(rule.severity, inTest),
            file: file.filename,
            line,
            category: rule.category,
            issue: rule.issue,
            recommendation: rule.recommendation,
            cwe: rule.cwe
          });
          triggeredCategories.add(rule.category);
        }
      }

      const entropyHit = detectEntropySecret(content);
      if (entropyHit) {
        findings.push({
          severity: dampen("high", inTest),
          file: file.filename,
          line,
          category: "secrets",
          issue: `High-entropy value (~${entropyHit.entropy.toFixed(1)} bits/char) assigned to a secret-shaped identifier.`,
          recommendation: "If this is a real credential, remove it and rotate. If it is a test fixture, mark the line with // pr-agent-ignore.",
          cwe: "CWE-798"
        });
        triggeredCategories.add("secrets");
      }
    }
  }

  // Dependency manifest change — informational, not a bug.
  for (const file of context.files) {
    if (/(?:package\.json|requirements\.txt|pom\.xml|build\.gradle|go\.mod|Cargo\.toml|Pipfile|composer\.json)$/i.test(file.filename)) {
      triggeredCategories.add("dependencies");
      findings.push({
        severity: "low",
        file: file.filename,
        line: 0,
        category: "dependencies",
        issue: "Dependency manifest changed.",
        recommendation: "Review new/updated dependencies for known advisories (npm audit / pip-audit / govulncheck) and pin versions."
      });
    }
  }

  // Fold in findings from external scanners (Semgrep/Gitleaks/Trivy) if they left
  // SARIF in the workspace. Absent SARIF → empty result → unchanged behavior.
  const sarifDir = process.env.PR_AGENT_SARIF_DIR?.trim() || cwd;
  const sarif = readSarifFindings(sarifDir, context.files.map((file) => file.filename));
  for (const hit of sarif.findings) {
    findings.push({
      severity: hit.severity,
      file: hit.file || "(repository)",
      line: hit.line,
      category: hit.tool.toLowerCase(),
      issue: hit.issue,
      recommendation: hit.recommendation,
      cwe: hit.cwe
    });
    triggeredCategories.add(hit.tool.toLowerCase());
  }

  const deduped = dedupe(findings);
  const riskLevel = deduped.length
    ? highestRisk(deduped.map((finding) => SEVERITY_TO_RISK[finding.severity]))
    : "clean";

  const output = renderSection(deduped, riskLevel, triggeredCategories, sarif);

  return {
    agent: "security",
    pr_number: context.prNumber,
    status: "complete",
    risk_level: riskLevel,
    output_markdown: output,
    findings_count: deduped.length,
    processing_time_ms: Date.now() - start,
    findings: deduped
  };
}

/** Risk level implied by a set of findings. Exported for tests and the triage pass. */
export function riskFromFindings(findings: Finding[]): RiskLevel {
  return findings.length ? highestRisk(findings.map((finding) => SEVERITY_TO_RISK[finding.severity])) : "clean";
}

function dampen(severity: Severity, inTest: boolean): Severity {
  if (!inTest) return severity;
  if (severity === "critical") return "high";
  if (severity === "high") return "medium";
  if (severity === "medium") return "low";
  return "low";
}

function shannonEntropy(value: string): number {
  const counts = new Map<string, number>();
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
  }
  let entropy = 0;
  for (const count of counts.values()) {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  }
  return entropy;
}

function detectEntropySecret(content: string): { entropy: number } | null {
  const match = ENTROPY_ASSIGN.exec(content);
  if (!match) return null;
  const value = match[2];
  if (!value) return null;
  // Skip obvious placeholders / examples.
  if (/^(?:changeme|example|placeholder|dummy|xxx+|test+|foo+|bar+|your[_-])/i.test(value)) return null;
  if (/^[a-f0-9]+$/i.test(value) && value.length < 32) return null;
  const entropy = shannonEntropy(value);
  return entropy >= ENTROPY_THRESHOLD ? { entropy } : null;
}

function dedupe(findings: Finding[]): Finding[] {
  const seen = new Set<string>();
  const result: Finding[] = [];
  for (const finding of findings) {
    const key = `${finding.file}:${finding.line}:${finding.category}:${finding.issue}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push(finding);
    }
  }
  return result.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]);
}

function riskBadge(risk: RiskLevel): string {
  switch (risk) {
    case "critical":
      return "🔴 Critical";
    case "high":
      return "🟠 High";
    case "medium":
      return "🟡 Medium";
    case "low":
      return "🔵 Low";
    default:
      return "🟢 Clean";
  }
}

function renderSection(findings: Finding[], risk: RiskLevel, triggered: Set<string>, sarif: SarifIngestResult): string {
  const lines: string[] = ["## 🔒 Security Analysis", "", `**Risk level:** ${riskBadge(risk)}`, ""];

  if (findings.length === 0) {
    lines.push("✅ No security issues detected", "");
  } else {
    const counts: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };
    for (const finding of findings) counts[finding.severity] += 1;
    lines.push(
      `**Summary:** ${counts.critical} critical · ${counts.high} high · ${counts.medium} medium · ${counts.low} low`,
      "",
      "**Findings:**"
    );
    for (const finding of findings) {
      const location = finding.line > 0 ? `\`${finding.file}:${finding.line}\`` : `\`${finding.file}\``;
      const cwe = finding.cwe ? ` [${finding.cwe}]` : "";
      lines.push(`- ${SEVERITY_ICON[finding.severity]} — ${location} — [${finding.category}]${cwe} ${finding.issue}`);
      lines.push(`  *Recommendation:* ${finding.recommendation}`);
    }
    lines.push("");
  }

  const categoryStatus = CATEGORIES.map((category) => `${category} ${triggered.has(category) ? "⚠️" : "✅"}`).join(" · ");
  lines.push(`**Categories checked:** ${categoryStatus}`);
  lines.push("");

  if (sarif.tools.length > 0) {
    const summary = sarif.tools.map((tool) => `${tool.name} (${tool.count})`).join(" · ");
    lines.push(`**External scanners:** ${summary}${sarif.truncated ? " · _(list truncated to first 100 findings)_" : ""}`);
  } else if (sarif.scannersRun.length > 0) {
    lines.push(`**External scanners:** ${sarif.scannersRun.join(", ")} ran — no findings beyond the rule engine.`);
  } else {
    lines.push("**External scanners:** not run — regex engine only (needs Docker running, or SARIF in CI).");
  }
  lines.push("");
  lines.push("_Suppress a false positive by adding `// pr-agent-ignore` or `// nosec` on the flagged line._");

  return lines.join("\n");
}
