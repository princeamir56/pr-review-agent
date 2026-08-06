import { promises as fs } from "node:fs";
import * as path from "node:path";
import { AgentEnvelope, Finding, RiskLevel, Severity } from "./types";

/**
 * One row per completed review. Written append-only so a crash mid-write can never
 * corrupt earlier rows, and so the file stays readable with `tail`.
 *
 * Deliberately newline-delimited JSON rather than SQLite: the MCP server ships with
 * three runtime dependencies and no native modules, and a native SQLite binding
 * would break `npm ci` on any platform without a prebuilt binary. Everything the
 * trends view needs is an aggregate over a few thousand rows, which this handles
 * fine. Swap in a real database when rows outgrow a single file.
 */
export interface RunRecord {
  timestamp: string;
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  riskLevel: RiskLevel;
  recommendation: string;
  durationMs: number;
  filesChanged: number;
  agents: string[];
  severityCounts: Record<Severity, number>;
  /** Rule categories that fired, for "which rules actually earn their keep" reporting. */
  categories: string[];
  dismissed: number;
}

export interface RunTrends {
  totalRuns: number;
  prsReviewed: number;
  meanDurationMs: number;
  severityTotals: Record<Severity, number>;
  byRecommendation: Record<string, number>;
  /** Categories ordered by how often they fired, most frequent first. */
  topCategories: Array<{ category: string; count: number }>;
  dismissedTotal: number;
  firstRun: string | null;
  lastRun: string | null;
}

const STORE_FILE = ".runs.jsonl";
const EMPTY_SEVERITIES: Record<Severity, number> = { critical: 0, high: 0, medium: 0, low: 0 };

export function runStorePath(cwd: string): string {
  return path.join(cwd, "docs", "pr-reviews", STORE_FILE);
}

export function countSeverities(findings: Finding[]): Record<Severity, number> {
  const counts: Record<Severity, number> = { ...EMPTY_SEVERITIES };
  for (const finding of findings) {
    if (!finding.dismissed) {
      counts[finding.severity] += 1;
    }
  }
  return counts;
}

/**
 * Build the record for a finished review. Pure, so the shape can be asserted in a
 * test without touching the filesystem.
 */
export function buildRunRecord(input: {
  owner: string;
  repo: string;
  prNumber: number;
  headSha: string;
  riskLevel: RiskLevel;
  recommendation: string;
  durationMs: number;
  filesChanged: number;
  envelopes: AgentEnvelope[];
}): RunRecord {
  const findings = input.envelopes.flatMap((envelope) => envelope.findings ?? []);
  const categories = [...new Set(findings.filter((f) => !f.dismissed).map((f) => f.category))].sort();

  return {
    timestamp: new Date().toISOString(),
    owner: input.owner,
    repo: input.repo,
    prNumber: input.prNumber,
    headSha: input.headSha,
    riskLevel: input.riskLevel,
    recommendation: input.recommendation,
    durationMs: input.durationMs,
    filesChanged: input.filesChanged,
    agents: input.envelopes.map((envelope) => envelope.agent),
    severityCounts: countSeverities(findings),
    categories,
    dismissed: findings.filter((finding) => finding.dismissed).length
  };
}

/** Append a record. Never throws — losing a metrics row must not fail a review. */
export async function appendRun(cwd: string, record: RunRecord): Promise<void> {
  try {
    const file = runStorePath(cwd);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.appendFile(file, `${JSON.stringify(record)}\n`, "utf8");
  } catch (error) {
    console.error(`[pr-agent] could not record run metrics: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Every recorded run, oldest first. Malformed lines are skipped, not fatal. */
export async function readRuns(cwd: string): Promise<RunRecord[]> {
  let raw: string;
  try {
    raw = await fs.readFile(runStorePath(cwd), "utf8");
  } catch {
    return [];
  }

  const records: RunRecord[] = [];
  for (const line of raw.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      records.push(JSON.parse(trimmed) as RunRecord);
    } catch {
      // A partially written final line. Ignore it.
    }
  }
  return records;
}

export function summarizeRuns(records: RunRecord[]): RunTrends {
  const severityTotals: Record<Severity, number> = { ...EMPTY_SEVERITIES };
  const byRecommendation: Record<string, number> = {};
  const categoryCounts = new Map<string, number>();
  let durationTotal = 0;
  let dismissedTotal = 0;

  for (const record of records) {
    for (const severity of Object.keys(severityTotals) as Severity[]) {
      severityTotals[severity] += record.severityCounts?.[severity] ?? 0;
    }
    byRecommendation[record.recommendation] = (byRecommendation[record.recommendation] ?? 0) + 1;
    for (const category of record.categories ?? []) {
      categoryCounts.set(category, (categoryCounts.get(category) ?? 0) + 1);
    }
    durationTotal += record.durationMs ?? 0;
    dismissedTotal += record.dismissed ?? 0;
  }

  const topCategories = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => b.count - a.count || a.category.localeCompare(b.category));

  return {
    totalRuns: records.length,
    prsReviewed: new Set(records.map((record) => `${record.owner}/${record.repo}#${record.prNumber}`)).size,
    meanDurationMs: records.length ? Math.round(durationTotal / records.length) : 0,
    severityTotals,
    byRecommendation,
    topCategories,
    dismissedTotal,
    firstRun: records[0]?.timestamp ?? null,
    lastRun: records[records.length - 1]?.timestamp ?? null
  };
}
