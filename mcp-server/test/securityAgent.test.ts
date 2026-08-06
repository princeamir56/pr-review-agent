import { describe, expect, it } from "vitest";
import { riskFromFindings, runSecurityAgent } from "../src/agents/securityAgent";
import { Finding } from "../src/agents/types";
import { contextOf, fileOf } from "./helpers";

/** Run the agent over one file of added lines and return its findings. */
function scan(lines: string[], filename = "src/app.ts"): Finding[] {
  const envelope = runSecurityAgent(contextOf({ files: [fileOf(filename, lines)] }), "/nonexistent-sarif-dir");
  return envelope.findings ?? [];
}

/**
 * The vulnerable corpus. Each entry must produce at least one finding in the
 * named category — this is what makes "18 categories covered" a measured claim
 * rather than a README assertion.
 */
const VULNERABLE: Array<[category: string, line: string]> = [
  ["secrets", 'const token = "ghp_abcdefghijklmnopqrstuvwxyz1234";'],
  ["secrets", 'const awsKey = "AKIAIOSFODNN7EXAMPLE";'],
  ["secrets", "-----BEGIN RSA PRIVATE KEY-----"],
  ["injection", "eval(userInput);"],
  ["injection", 'os.system("rm -rf " + path)'],
  ["xss", "element.innerHTML = untrusted;"],
  ["sql", 'db.query("SELECT * FROM users WHERE id = " + req.params.id);'],
  ["cors/csp", 'res.setHeader("Access-Control-Allow-Origin", "*");'],
  ["auth", "function isAuthenticated(req) { return true; }"],
  ["input-validation", "const id = req.body.id;"],
  ["path-traversal", "fs.readFileSync(path.join(base, req.query.file));"],
  ["ssrf", "const upstream = await fetch(req.query.url);"],
  ["deserialization", "config = yaml.load(raw)"],
  ["crypto", 'const digest = crypto.createHash("md5").update(password);'],
  ["open-redirect", "res.redirect(req.query.next);"],
  ["cookie", 'res.cookie("sid", sessionId);'],
  ["tls", "const agent = new https.Agent({ rejectUnauthorized: false });"],
  ["prototype-pollution", "const merged = Object.assign({}, req.body);"],
  ["header-injection", 'res.setHeader("X-Trace-Id", req.query.trace);'],
  ["hardcoded", "const DEBUG = true;"]
];

/**
 * The safe corpus. Ordinary code that must produce no findings at all. This is
 * the half that measures false positives — the number that decides whether
 * anyone keeps the bot switched on.
 */
const SAFE: string[] = [
  "const total = items.reduce((sum, item) => sum + item.price, 0);",
  'logger.info("user signed in", { userId });',
  "export function formatDate(value: Date): string { return value.toISOString(); }",
  "const client = new GitHubClient(process.env.GITHUB_TOKEN);",
  'const endpoint = "https://api.stripe.com/v1/charges";',
  "const user = await db.users.findOne({ id });",
  'const hash = crypto.createHash("sha256").update(password).digest("hex");',
  'res.cookie("sid", sessionId, { httpOnly: true, secure: true });',
  "if (user.isAdmin) { return next(); }",
  "export const MAX_RETRIES = 3;",
  "type ReviewResult = { risk: string; findings: number };",
  "await queue.publish({ type: 'review.completed', prNumber });"
];

describe("security agent — vulnerable corpus", () => {
  it.each(VULNERABLE)("flags %s in: %s", (category, line) => {
    const categories = scan([line]).map((finding) => finding.category);
    expect(categories).toContain(category);
  });

  it("covers every category the README claims", () => {
    // The 18 documented categories. `dependencies` is a manifest-level signal
    // rather than a line rule, so it has its own test below.
    const documented = [
      "secrets", "injection", "auth", "hardcoded", "input-validation", "sql", "xss",
      "cors/csp", "path-traversal", "ssrf", "deserialization", "crypto",
      "open-redirect", "cookie", "tls", "prototype-pollution", "header-injection"
    ];
    const covered = new Set(VULNERABLE.map(([category]) => category));

    expect(documented.filter((category) => !covered.has(category))).toEqual([]);
  });
});

describe("security agent — safe corpus (false positives)", () => {
  it.each(SAFE)("stays quiet on: %s", (line) => {
    expect(scan([line])).toEqual([]);
  });

  it("has a zero false-positive rate over the whole safe corpus", () => {
    const noisy = SAFE.map((line) => ({ line, findings: scan([line]) })).filter((entry) => entry.findings.length > 0);

    expect(noisy.map((entry) => `${entry.line} → ${entry.findings.map((f) => f.category).join(", ")}`)).toEqual([]);
  });
});

describe("security agent — reporting behaviour", () => {
  it("reports the line number from the diff, not the index in the file", () => {
    const context = contextOf({ files: [fileOf("src/app.ts", ["const safe = 1;", "eval(userInput);"], 40)] });
    const findings = runSecurityAgent(context, "/nonexistent-sarif-dir").findings ?? [];

    expect(findings.some((finding) => finding.line === 41 && finding.category === "injection")).toBe(true);
  });

  it("honours an inline suppression comment", () => {
    expect(scan(["eval(userInput); // pr-agent-ignore"])).toEqual([]);
    expect(scan(["eval(userInput); // nosec"])).toEqual([]);
  });

  it("dampens severity one step inside test files", () => {
    const prod = scan(['const token = "ghp_abcdefghijklmnopqrstuvwxyz1234";'], "src/config.ts");
    const test = scan(['const token = "ghp_abcdefghijklmnopqrstuvwxyz1234";'], "src/__tests__/config.test.ts");

    const worst = (findings: Finding[]) => findings.find((finding) => finding.category === "secrets")?.severity;
    expect(worst(prod)).toBe("critical");
    expect(worst(test)).toBe("high");
  });

  it("catches a high-entropy credential no regex knows about", () => {
    const findings = scan(['const apiKey = "aB3xK9mQ2pL7wR4tY8uZ1nV6cE5s";']);
    expect(findings.some((finding) => finding.category === "secrets")).toBe(true);
  });

  it("skips lockfiles and minified bundles entirely", () => {
    expect(scan(['"integrity": "sha512-ghp_abcdefghijklmnopqrstuvwxyz1234"'], "package-lock.json")).toEqual([]);
    expect(scan(["eval(x)"], "public/bundle.min.js")).toEqual([]);
  });

  it("notes a dependency manifest change without a line number", () => {
    const context = contextOf({ files: [fileOf("package.json", ['  "express": "^4.19.2"'])] });
    const findings = runSecurityAgent(context, "/nonexistent-sarif-dir").findings ?? [];
    const dependency = findings.find((finding) => finding.category === "dependencies");

    expect(dependency).toBeDefined();
    expect(dependency?.line).toBe(0);
  });

  it("deduplicates identical findings but keeps distinct rules on one line", () => {
    const findings = scan(["eval(req.body.code);"]);
    const keys = findings.map((finding) => `${finding.file}:${finding.line}:${finding.category}:${finding.issue}`);

    expect(new Set(keys).size).toBe(keys.length);
    expect(findings.length).toBeGreaterThan(1);
  });

  it("is clean on an empty diff and reports so in the section", () => {
    const envelope = runSecurityAgent(contextOf({ files: [] }), "/nonexistent-sarif-dir");

    expect(envelope.risk_level).toBe("clean");
    expect(envelope.findings_count).toBe(0);
    expect(envelope.output_markdown).toContain("No security issues detected");
    expect(envelope.output_markdown).toContain("not run — regex engine only");
  });

  it("is deterministic — the same diff yields the same section twice", () => {
    const lines = VULNERABLE.map(([, line]) => line);
    expect(scan(lines)).toEqual(scan(lines));
  });
});

describe("riskFromFindings", () => {
  const finding = (severity: Finding["severity"]): Finding => ({
    severity,
    file: "a.ts",
    line: 1,
    category: "secrets",
    issue: "x",
    recommendation: "y"
  });

  it("is clean with no findings", () => {
    expect(riskFromFindings([])).toBe("clean");
  });

  it("takes the worst severity present", () => {
    expect(riskFromFindings([finding("low"), finding("critical"), finding("medium")])).toBe("critical");
    expect(riskFromFindings([finding("low"), finding("medium")])).toBe("medium");
  });
});
