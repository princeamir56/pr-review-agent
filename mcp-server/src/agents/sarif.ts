import { readdirSync, readFileSync } from "node:fs";
import * as path from "node:path";

export type SarifSeverity = "critical" | "high" | "medium" | "low";

/**
 * A finding lifted out of a SARIF file produced by an external scanner
 * (Semgrep, Gitleaks, Trivy, …). Shaped so the Security agent can fold it into
 * its own findings list without knowing which tool produced it.
 */
export interface SarifFinding {
  tool: string;
  severity: SarifSeverity;
  file: string;
  line: number;
  ruleId: string;
  issue: string;
  recommendation: string;
  cwe?: string;
}

export interface SarifIngestResult {
  findings: SarifFinding[];
  /** Tools whose SARIF was parsed, with how many findings each contributed. */
  tools: { name: string; count: number }[];
  /** Every scanner whose SARIF was parsed — even those that produced zero findings. */
  scannersRun: string[];
  /** True when the raw finding count exceeded the cap and the list was trimmed. */
  truncated: boolean;
}

/** Hard cap so a noisy scanner can't flood a PR review. */
const MAX_SARIF_FINDINGS = 100;

/**
 * Read every `*.sarif` file in `dir` (non-recursive) and return the findings,
 * restricted to `changedFiles` so the review stays scoped to the PR. Findings
 * without a file location (e.g. a dependency CVE) are always kept.
 *
 * Missing directory, unreadable or malformed SARIF files are skipped silently —
 * when no scanners ran, this returns an empty result and the agent behaves
 * exactly as it did before SARIF ingestion existed.
 */
export function readSarifFindings(dir: string, changedFiles: string[]): SarifIngestResult {
  const changed = new Set(changedFiles.map(normalizePath));
  const perTool = new Map<string, number>();
  const ran = new Set<string>();
  const collected: SarifFinding[] = [];

  let entries: string[];
  try {
    entries = readdirSync(dir).filter((name) => name.toLowerCase().endsWith(".sarif"));
  } catch {
    return { findings: [], tools: [], scannersRun: [], truncated: false };
  }

  for (const name of entries) {
    let doc: SarifDocument;
    try {
      doc = JSON.parse(readFileSync(path.join(dir, name), "utf8")) as SarifDocument;
    } catch {
      continue; // malformed / unreadable — skip
    }

    for (const run of doc.runs ?? []) {
      const toolName = run.tool?.driver?.name ?? "scanner";
      ran.add(toolName);
      const ruleIndex = indexRules(run);

      for (const result of run.results ?? []) {
        const mapped = mapResult(toolName, result, ruleIndex);
        if (!mapped) {
          continue;
        }
        // Scope to changed files; keep repo-level (no file) findings.
        if (mapped.file && changed.size > 0 && !matchesChanged(mapped.file, changed)) {
          continue;
        }
        collected.push(mapped);
        perTool.set(toolName, (perTool.get(toolName) ?? 0) + 1);
      }
    }
  }

  const truncated = collected.length > MAX_SARIF_FINDINGS;
  const findings = collected
    .sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
    .slice(0, MAX_SARIF_FINDINGS);

  return {
    findings,
    tools: [...perTool.entries()].map(([name, count]) => ({ name, count })),
    scannersRun: [...ran],
    truncated
  };
}

const SEVERITY_ORDER: Record<SarifSeverity, number> = { critical: 0, high: 1, medium: 2, low: 3 };

interface SarifDocument {
  runs?: SarifRun[];
}

interface SarifRun {
  tool?: { driver?: { name?: string; rules?: SarifRule[] } };
  results?: SarifResult[];
}

interface SarifRule {
  id?: string;
  name?: string;
  helpUri?: string;
  shortDescription?: { text?: string };
  fullDescription?: { text?: string };
  help?: { text?: string };
  properties?: { "security-severity"?: string; tags?: string[]; cwe?: string | string[] };
}

interface SarifResult {
  ruleId?: string;
  level?: string;
  message?: { text?: string };
  locations?: Array<{
    physicalLocation?: {
      artifactLocation?: { uri?: string };
      region?: { startLine?: number };
    };
  }>;
  properties?: { "security-severity"?: string };
}

function indexRules(run: SarifRun): Map<string, SarifRule> {
  const index = new Map<string, SarifRule>();
  for (const rule of run.tool?.driver?.rules ?? []) {
    if (rule.id) {
      index.set(rule.id, rule);
    }
  }
  return index;
}

function mapResult(tool: string, result: SarifResult, rules: Map<string, SarifRule>): SarifFinding | null {
  const ruleId = result.ruleId ?? "";
  const rule = ruleId ? rules.get(ruleId) : undefined;

  const location = result.locations?.[0]?.physicalLocation;
  const file = location?.artifactLocation?.uri ? normalizePath(location.artifactLocation.uri) : "";
  const line = location?.region?.startLine ?? 0;

  const securitySeverity = result.properties?.["security-severity"] ?? rule?.properties?.["security-severity"];
  const severity = toSeverity(result.level, securitySeverity);

  const message = result.message?.text?.trim() || rule?.shortDescription?.text?.trim() || ruleId || "Scanner finding.";
  const issue = ruleId ? `${ruleId}: ${message}` : message;
  const recommendation =
    rule?.help?.text?.trim() ||
    rule?.fullDescription?.text?.trim() ||
    (rule?.helpUri ? `See ${rule.helpUri}` : `Review the ${tool} finding and remediate.`);

  return {
    tool,
    severity,
    file,
    line,
    ruleId,
    issue: clip(issue, 300),
    recommendation: clip(recommendation, 300),
    cwe: extractCwe(rule)
  };
}

function toSeverity(level: string | undefined, securitySeverity: string | undefined): SarifSeverity {
  if (securitySeverity !== undefined) {
    const score = Number.parseFloat(securitySeverity);
    if (!Number.isNaN(score)) {
      if (score >= 9.0) return "critical";
      if (score >= 7.0) return "high";
      if (score >= 4.0) return "medium";
      return "low";
    }
  }
  switch (level) {
    case "error":
      return "high";
    case "warning":
      return "medium";
    case "note":
    case "none":
      return "low";
    default:
      return "low";
  }
}

function extractCwe(rule: SarifRule | undefined): string | undefined {
  if (!rule?.properties) return undefined;
  const { cwe, tags } = rule.properties;
  const pools: string[] = [];
  if (typeof cwe === "string") pools.push(cwe);
  if (Array.isArray(cwe)) pools.push(...cwe);
  if (Array.isArray(tags)) pools.push(...tags);
  for (const value of pools) {
    const match = /CWE[-_ ]?(\d+)/i.exec(value);
    if (match) return `CWE-${match[1]}`;
  }
  return undefined;
}

function normalizePath(uri: string): string {
  let value = uri;
  try {
    value = decodeURIComponent(uri);
  } catch {
    // keep raw on malformed escapes
  }
  return value
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\/+/, "");
}

function matchesChanged(file: string, changed: Set<string>): boolean {
  if (changed.has(file)) return true;
  for (const candidate of changed) {
    if (file.endsWith(candidate) || candidate.endsWith(file)) {
      return true;
    }
  }
  return false;
}

function clip(value: string, max: number): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max - 1)}…`;
}
