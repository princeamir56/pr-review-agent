import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSarifFindings } from "../src/agents/sarif";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-agent-sarif-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function sarif(toolName: string, results: unknown[], rules: unknown[] = []): string {
  return JSON.stringify({
    version: "2.1.0",
    runs: [{ tool: { driver: { name: toolName, rules } }, results }]
  });
}

function result(file: string, line: number, level = "error", ruleId = "rule-1"): unknown {
  return {
    ruleId,
    level,
    message: { text: `Problem in ${file}` },
    locations: [{ physicalLocation: { artifactLocation: { uri: file }, region: { startLine: line } } }]
  };
}

const write = (name: string, body: string) => fs.writeFile(path.join(dir, name), body, "utf8");

describe("readSarifFindings", () => {
  it("returns nothing for a directory that does not exist", () => {
    const ingest = readSarifFindings(path.join(dir, "missing"), ["src/app.ts"]);

    expect(ingest.findings).toEqual([]);
    expect(ingest.tools).toEqual([]);
    expect(ingest.scannersRun).toEqual([]);
  });

  it("reads results and attributes them to the scanner", async () => {
    await write("semgrep.sarif", sarif("Semgrep OSS", [result("src/app.ts", 12)]));
    const ingest = readSarifFindings(dir, ["src/app.ts"]);

    expect(ingest.findings).toHaveLength(1);
    expect(ingest.findings[0]?.file).toBe("src/app.ts");
    expect(ingest.findings[0]?.line).toBe(12);
    expect(ingest.tools[0]?.name).toContain("Semgrep");
  });

  it("drops findings in files the PR did not touch", async () => {
    await write("semgrep.sarif", sarif("Semgrep", [result("src/app.ts", 1), result("legacy/other.ts", 5)]));
    const ingest = readSarifFindings(dir, ["src/app.ts"]);

    expect(ingest.findings.map((f) => f.file)).toEqual(["src/app.ts"]);
  });

  it("distinguishes a scanner that ran clean from one that never ran", async () => {
    await write("trivy.sarif", sarif("Trivy", []));
    const ingest = readSarifFindings(dir, ["src/app.ts"]);

    expect(ingest.findings).toEqual([]);
    expect(ingest.scannersRun.length).toBeGreaterThan(0);
    expect(ingest.tools).toEqual([]);
  });

  it("caps a flood of findings", async () => {
    const many = Array.from({ length: 150 }, (_, index) => result("src/app.ts", index + 1));
    await write("semgrep.sarif", sarif("Semgrep", many));
    const ingest = readSarifFindings(dir, ["src/app.ts"]);

    expect(ingest.findings).toHaveLength(100);
    expect(ingest.truncated).toBe(true);
  });

  it("ignores a malformed SARIF file instead of failing the review", async () => {
    await write("broken.sarif", "{ not json");
    await write("semgrep.sarif", sarif("Semgrep", [result("src/app.ts", 3)]));

    expect(readSarifFindings(dir, ["src/app.ts"]).findings).toHaveLength(1);
  });

  it("maps SARIF levels onto the agent's severities", async () => {
    await write(
      "semgrep.sarif",
      sarif("Semgrep", [result("src/app.ts", 1, "error"), result("src/app.ts", 2, "warning"), result("src/app.ts", 3, "note")])
    );
    const severities = readSarifFindings(dir, ["src/app.ts"]).findings.map((f) => f.severity);

    expect(new Set(severities).size).toBeGreaterThan(1);
    expect(severities.every((severity) => ["critical", "high", "medium", "low"].includes(severity))).toBe(true);
  });
});
