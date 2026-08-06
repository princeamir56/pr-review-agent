import { promises as fs } from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { findLatestReviewDoc, mergeDocument, reviewDocName, selectInlineComments } from "../src/orchestrator";
import { AgentEnvelope, Finding } from "../src/agents/types";
import { contextOf } from "./helpers";

const FIXED_NOW = new Date("2026-08-05T09:30:00.000Z");

function envelope(overrides: Partial<AgentEnvelope> & Pick<AgentEnvelope, "agent">): AgentEnvelope {
  return {
    pr_number: 42,
    status: "complete",
    risk_level: "clean",
    output_markdown: `## ${overrides.agent}\n\nbody`,
    findings_count: 0,
    processing_time_ms: 0,
    ...overrides
  };
}

function finding(overrides: Partial<Finding> = {}): Finding {
  return {
    severity: "high",
    file: "src/app.ts",
    line: 12,
    category: "injection",
    issue: "Dynamic eval of user input.",
    recommendation: "Parse the value instead.",
    ...overrides
  };
}

describe("mergeDocument", () => {
  const envelopes = [
    envelope({ agent: "summary", output_markdown: "## 📋 Summary\n\nAdds rate limiting." }),
    envelope({
      agent: "security",
      risk_level: "high",
      findings_count: 2,
      output_markdown: "## 🔒 Security Analysis\n\n**Risk level:** 🟠 High"
    }),
    envelope({
      agent: "documentation",
      risk_level: "medium",
      findings_count: 1,
      output_markdown: "## 📚 Documentation\n\nREADME drift."
    })
  ];

  it("produces the canonical report — golden snapshot", () => {
    const markdown = mergeDocument(contextOf(), envelopes, "high", "REQUEST CHANGES", null, FIXED_NOW);
    expect(markdown).toMatchSnapshot();
  });

  it("reports the documentation agent's real risk, not a hardcoded Low", () => {
    const markdown = mergeDocument(contextOf(), envelopes, "high", "REQUEST CHANGES", null, FIXED_NOW);
    expect(markdown).toContain("| Documentation | 🟡 Updates needed | Medium |");
  });

  it("shows an em dash for the documentation risk when that agent did not run", () => {
    const markdown = mergeDocument(contextOf(), [envelopes[0]!], "low", "APPROVE", null, FIXED_NOW);
    expect(markdown).toContain("| Documentation | — Skipped | — |");
  });

  it("marks a failed agent without dropping the other sections", () => {
    const failed = [
      envelopes[0]!,
      envelope({ agent: "security", status: "error", output_markdown: "## 🔒 Security Analysis\n\n⚠️ failed" }),
      envelopes[2]!
    ];
    const markdown = mergeDocument(contextOf(), failed, "clean", "APPROVE", null, FIXED_NOW);

    expect(markdown).toContain("| Security | ⚠️ Failed |");
    expect(markdown).toContain("Adds rate limiting.");
    expect(markdown).toContain("README drift.");
  });

  it("omits the LLM section entirely when the pass did not run", () => {
    const markdown = mergeDocument(contextOf(), envelopes, "high", "REQUEST CHANGES", null, FIXED_NOW);
    expect(markdown).not.toContain("LLM Review Pass");
  });

  it("appends the LLM section when the pass produced something", () => {
    const markdown = mergeDocument(contextOf(), envelopes, "high", "REQUEST CHANGES", {
      model: "claude-opus-5",
      durationMs: 4200,
      observations: [{ file: "src/app.ts", line: 9, issue: "Off-by-one on the retry counter.", why_it_matters: "Last retry never runs." }],
      dismissals: [{ index: 1, reason: "Placeholder documented in .env.example." }]
    }, FIXED_NOW);

    expect(markdown).toContain("## 🤖 LLM Review Pass");
    expect(markdown).toContain("Off-by-one on the retry counter.");
    expect(markdown).toContain("finding #1");
    // The deterministic decision table still comes last and is unchanged.
    expect(markdown.indexOf("## ✅ Review Decision")).toBeGreaterThan(markdown.indexOf("## 🤖 LLM Review Pass"));
  });
});

describe("reviewDocName", () => {
  it("includes the short head SHA so same-day runs do not collide", () => {
    expect(reviewDocName(42, "a1b2c3d4e5f6a7b8", FIXED_NOW)).toBe("PR-42-2026-08-05-a1b2c3d.md");
  });

  it("falls back to the date-only name when there is no SHA", () => {
    expect(reviewDocName(42, "", FIXED_NOW)).toBe("PR-42-2026-08-05.md");
  });

  it("gives two commits on the same day different filenames", () => {
    expect(reviewDocName(42, "aaaaaaa", FIXED_NOW)).not.toBe(reviewDocName(42, "bbbbbbb", FIXED_NOW));
  });
});

describe("findLatestReviewDoc", () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), "pr-agent-docs-"));
    await fs.mkdir(path.join(dir, "docs", "pr-reviews"), { recursive: true });
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  const write = (name: string) => fs.writeFile(path.join(dir, "docs", "pr-reviews", name), "x", "utf8");

  it("returns null when nothing has been generated", async () => {
    expect(await findLatestReviewDoc(dir, 42)).toBeNull();
  });

  it("picks the newest date", async () => {
    await write("PR-42-2026-08-01-aaaaaaa.md");
    await write("PR-42-2026-08-05-bbbbbbb.md");

    expect(await findLatestReviewDoc(dir, 42)).toBe(path.join(dir, "docs", "pr-reviews", "PR-42-2026-08-05-bbbbbbb.md"));
  });

  it("still finds reports written before the SHA was added to the name", async () => {
    await write("PR-42-2026-08-05.md");
    expect(await findLatestReviewDoc(dir, 42)).toContain("PR-42-2026-08-05.md");
  });

  it("does not confuse PR 4 with PR 42", async () => {
    await write("PR-42-2026-08-05-aaaaaaa.md");
    expect(await findLatestReviewDoc(dir, 4)).toBeNull();
  });
});

describe("selectInlineComments", () => {
  it("posts critical and high findings only", () => {
    const comments = selectInlineComments([
      finding({ severity: "critical", line: 1 }),
      finding({ severity: "high", line: 2 }),
      finding({ severity: "medium", line: 3 }),
      finding({ severity: "low", line: 4 })
    ]);

    expect(comments.map((comment) => comment.line)).toEqual([1, 2]);
  });

  it("skips findings with no line — GitHub rejects a review that misses the diff", () => {
    expect(selectInlineComments([finding({ severity: "critical", line: 0 })])).toEqual([]);
  });

  it("skips findings the LLM pass dismissed", () => {
    expect(selectInlineComments([finding({ dismissed: true, dismissedReason: "test fixture" })])).toEqual([]);
  });

  it("posts one comment per line even when several rules fire there", () => {
    const comments = selectInlineComments([
      finding({ category: "injection" }),
      finding({ category: "input-validation" })
    ]);

    expect(comments).toHaveLength(1);
  });

  it("caps the number of comments so a bad PR cannot bury the diff", () => {
    const many = Array.from({ length: 50 }, (_, index) => finding({ line: index + 1 }));
    expect(selectInlineComments(many)).toHaveLength(20);
  });

  it("writes a body carrying severity, category, CWE and the recommendation", () => {
    const [comment] = selectInlineComments([finding({ severity: "critical", cwe: "CWE-95" })]);

    expect(comment?.body).toContain("CRITICAL — injection");
    expect(comment?.body).toContain("[CWE-95]");
    expect(comment?.body).toContain("Parse the value instead.");
    expect(comment?.path).toBe("src/app.ts");
  });
});
