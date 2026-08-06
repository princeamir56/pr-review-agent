import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { appendRun, buildRunRecord, countSeverities, readRuns, runStorePath, summarizeRuns } from "../src/agents/runStore";
import { AgentEnvelope, Finding } from "../src/agents/types";

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "high",
    file: "src/app.ts",
    line: 1,
    category: "injection",
    issue: "x",
    recommendation: "y",
    ...overrides
  };
}

function securityEnvelope(findings: Finding[]): AgentEnvelope {
  return {
    agent: "security",
    pr_number: 1,
    status: "complete",
    risk_level: "high",
    output_markdown: "",
    findings_count: findings.length,
    processing_time_ms: 5,
    findings
  };
}

describe("countSeverities", () => {
  it("counts by severity and ignores dismissed findings", () => {
    const counts = countSeverities([
      finding({ severity: "critical" }),
      finding({ severity: "high" }),
      finding({ severity: "high", dismissed: true }),
      finding({ severity: "low" })
    ]);

    expect(counts).toEqual({ critical: 1, high: 1, medium: 0, low: 1 });
  });
});

describe("buildRunRecord", () => {
  const input = {
    owner: "mobelite",
    repo: "pr-review-agent",
    prNumber: 42,
    headSha: "a1b2c3d",
    riskLevel: "high" as const,
    recommendation: "REQUEST CHANGES",
    durationMs: 1200,
    filesChanged: 7,
    envelopes: [securityEnvelope([finding({ category: "injection" }), finding({ category: "secrets", severity: "critical" })])]
  };

  it("captures the shape the trends view needs", () => {
    const record = buildRunRecord(input);

    expect(record).toMatchObject({
      owner: "mobelite",
      prNumber: 42,
      headSha: "a1b2c3d",
      riskLevel: "high",
      recommendation: "REQUEST CHANGES",
      durationMs: 1200,
      filesChanged: 7,
      agents: ["security"],
      categories: ["injection", "secrets"],
      dismissed: 0
    });
    expect(record.severityCounts).toEqual({ critical: 1, high: 1, medium: 0, low: 0 });
    expect(Date.parse(record.timestamp)).not.toBeNaN();
  });

  it("counts dismissals separately and drops them from the category list", () => {
    const record = buildRunRecord({
      ...input,
      envelopes: [securityEnvelope([finding({ category: "tls", dismissed: true })])]
    });

    expect(record.dismissed).toBe(1);
    expect(record.categories).toEqual([]);
  });

  it("tolerates agents that emit no findings", () => {
    const record = buildRunRecord({
      ...input,
      envelopes: [{ agent: "summary", pr_number: 1, status: "complete", risk_level: "low", output_markdown: "", findings_count: 0, processing_time_ms: 1 }]
    });

    expect(record.severityCounts).toEqual({ critical: 0, high: 0, medium: 0, low: 0 });
  });
});

describe("summarizeRuns", () => {
  const record = (overrides: Partial<ReturnType<typeof buildRunRecord>> = {}) => ({
    timestamp: "2026-08-05T09:00:00.000Z",
    owner: "mobelite",
    repo: "pr-review-agent",
    prNumber: 1,
    headSha: "aaa",
    riskLevel: "low" as const,
    recommendation: "APPROVE",
    durationMs: 1000,
    filesChanged: 1,
    agents: ["security"],
    severityCounts: { critical: 0, high: 0, medium: 0, low: 1 },
    categories: ["tls"],
    dismissed: 0,
    ...overrides
  });

  it("returns an empty summary for no runs", () => {
    const trends = summarizeRuns([]);

    expect(trends.totalRuns).toBe(0);
    expect(trends.meanDurationMs).toBe(0);
    expect(trends.firstRun).toBeNull();
    expect(trends.topCategories).toEqual([]);
  });

  it("aggregates counts, means, and category frequency", () => {
    const trends = summarizeRuns([
      record({ durationMs: 1000, categories: ["tls", "secrets"], severityCounts: { critical: 1, high: 0, medium: 0, low: 0 } }),
      record({ durationMs: 3000, categories: ["secrets"], recommendation: "REQUEST CHANGES", dismissed: 2, prNumber: 2 })
    ]);

    expect(trends.totalRuns).toBe(2);
    expect(trends.prsReviewed).toBe(2);
    expect(trends.meanDurationMs).toBe(2000);
    expect(trends.severityTotals).toEqual({ critical: 1, high: 0, medium: 0, low: 1 });
    expect(trends.byRecommendation).toEqual({ APPROVE: 1, "REQUEST CHANGES": 1 });
    expect(trends.topCategories[0]).toEqual({ category: "secrets", count: 2 });
    expect(trends.dismissedTotal).toBe(2);
  });

  it("counts repeat reviews of one PR as a single PR", () => {
    expect(summarizeRuns([record(), record()]).prsReviewed).toBe(1);
  });
});

describe("the store on disk", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-agent-runs-"));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("returns no runs before anything is written", async () => {
    expect(await readRuns(dir)).toEqual([]);
  });

  it("appends and reads back in order", async () => {
    const first = buildRunRecord({
      owner: "o", repo: "r", prNumber: 1, headSha: "a", riskLevel: "clean",
      recommendation: "APPROVE", durationMs: 1, filesChanged: 1, envelopes: []
    });
    const second = { ...first, prNumber: 2 };

    await appendRun(dir, first);
    await appendRun(dir, second);

    const runs = await readRuns(dir);
    expect(runs.map((run) => run.prNumber)).toEqual([1, 2]);
  });

  it("skips a truncated final line instead of throwing", async () => {
    const file = runStorePath(dir);
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, `${JSON.stringify({ prNumber: 1 })}\n{"prNumber": 2, "trunca`, "utf8");

    const runs = await readRuns(dir);
    expect(runs).toHaveLength(1);
  });

  it("never throws when the path cannot be written", async () => {
    await expect(appendRun("\0invalid", buildRunRecord({
      owner: "o", repo: "r", prNumber: 1, headSha: "a", riskLevel: "clean",
      recommendation: "APPROVE", durationMs: 1, filesChanged: 0, envelopes: []
    }))).resolves.toBeUndefined();
  });
});
