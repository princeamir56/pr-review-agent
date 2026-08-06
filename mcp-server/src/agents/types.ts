import { ChangedFile } from "../github/githubClient";

/**
 * Risk levels shared across agents and the merged report, lowest to highest.
 */
export type RiskLevel = "clean" | "low" | "medium" | "high" | "critical";

export const RISK_ORDER: Record<RiskLevel, number> = {
  clean: 0,
  low: 1,
  medium: 2,
  high: 3,
  critical: 4
};

export type Severity = "critical" | "high" | "medium" | "low";

/**
 * One located problem. Carried on the envelope (not just rendered into markdown) so
 * the orchestrator can anchor high-severity items to their diff lines as inline
 * review comments, and hand them to the optional LLM triage pass.
 */
export interface Finding {
  severity: Severity;
  file: string;
  line: number;
  category: string;
  issue: string;
  recommendation: string;
  cwe?: string;
  /** Set by the LLM pass when it judges a finding to be a false positive. */
  dismissed?: boolean;
  dismissedReason?: string;
}

/**
 * The structured envelope every specialist agent returns. Mirrors the
 * "Agent Communication Protocol" documented in the agent .md files.
 */
export interface AgentEnvelope {
  agent: "summary" | "security" | "documentation";
  pr_number: number;
  status: "complete" | "error" | "skipped";
  risk_level: RiskLevel;
  output_markdown: string;
  findings_count: number;
  processing_time_ms: number;
  /** Structured findings behind `output_markdown`. Optional: only Security emits them. */
  findings?: Finding[];
}

/**
 * Fully resolved pull request context passed to every agent. Built once by the
 * orchestrator so the three agents share the same GitHub data (rate-limit safe).
 */
export interface PRContext {
  owner: string;
  repo: string;
  prNumber: number;
  title: string;
  body: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  htmlUrl: string;
  files: ChangedFile[];
  commits: string[];
}

/**
 * An added/modified line located within a file's patch, with its line number on
 * the new (RIGHT) side of the diff.
 */
export interface AddedLine {
  line: number;
  content: string;
}

/**
 * Parse a unified diff patch and return every added line ("+" lines) with its
 * resolved line number on the new version of the file. Removed and context lines
 * are skipped. This is how agents produce real `path:line` references.
 */
export function parseAddedLines(patch: string): AddedLine[] {
  if (!patch) {
    return [];
  }

  const result: AddedLine[] = [];
  let newLineNumber = 0;

  for (const raw of patch.split("\n")) {
    const hunk = /^@@ -\d+(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(raw);
    if (hunk && hunk[1]) {
      newLineNumber = Number.parseInt(hunk[1], 10);
      continue;
    }

    if (raw.startsWith("+++") || raw.startsWith("---")) {
      continue;
    }

    if (raw.startsWith("+")) {
      result.push({ line: newLineNumber, content: raw.slice(1) });
      newLineNumber += 1;
    } else if (raw.startsWith("-")) {
      // removed line — does not advance the new-file counter
    } else {
      // context line
      newLineNumber += 1;
    }
  }

  return result;
}

/**
 * Detect a coarse language for a file path, used to pick a docstring style.
 */
export function detectLanguage(filename: string): "python" | "typescript" | "javascript" | "java" | "other" {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".py")) {
    return "python";
  }
  if (lower.endsWith(".ts") || lower.endsWith(".tsx")) {
    return "typescript";
  }
  if (lower.endsWith(".js") || lower.endsWith(".jsx") || lower.endsWith(".mjs") || lower.endsWith(".cjs")) {
    return "javascript";
  }
  if (lower.endsWith(".java")) {
    return "java";
  }
  return "other";
}

/**
 * Returns the highest risk level among the provided values.
 */
export function highestRisk(levels: RiskLevel[]): RiskLevel {
  return levels.reduce<RiskLevel>((acc, level) => (RISK_ORDER[level] > RISK_ORDER[acc] ? level : acc), "clean");
}
