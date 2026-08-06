import { describe, expect, it } from "vitest";
import { runSummaryAgent } from "../src/agents/summaryAgent";
import { llmPassEnabled } from "../src/agents/llmPass";
import { contextOf, fileOf } from "./helpers";

describe("summary agent", () => {
  it("reports the file count and line totals", () => {
    const context = contextOf({
      files: [fileOf("src/a.ts", ["one", "two"]), fileOf("src/b.ts", ["three"])]
    });
    const envelope = runSummaryAgent(context);

    expect(envelope.status).toBe("complete");
    expect(envelope.findings_count).toBe(2);
    expect(envelope.output_markdown).toContain("Touches 2 files");
    expect(envelope.output_markdown).toContain("+3/-0 lines");
  });

  it.each([
    ["Fix the null pointer in the parser", "bug fix"],
    ["Refactor the token cache", "refactor"],
    ["Hotfix: revert the bad migration", "hotfix"],
    ["Bump express to 4.19.2", "chore"]
  ])("infers intent from the title %s", (title, expected) => {
    const envelope = runSummaryAgent(contextOf({ title, body: "", files: [fileOf("src/a.ts", ["x"])] }));
    expect(envelope.output_markdown).toContain(`\`${expected}\``);
  });

  it("recognises a docs-only change from the file extensions", () => {
    const envelope = runSummaryAgent(contextOf({ title: "Update guide", body: "", files: [fileOf("README.md", ["text"])] }));
    expect(envelope.output_markdown).toContain("`docs`");
  });

  it("recognises a tests-only change", () => {
    const envelope = runSummaryAgent(contextOf({ title: "More coverage", body: "", files: [fileOf("src/__tests__/a.test.ts", ["x"])] }));
    expect(envelope.output_markdown).toContain("`test`");
  });

  it("scales complexity with the size of the change", () => {
    const small = runSummaryAgent(contextOf({ files: [fileOf("src/a.ts", ["x"])] }));
    const large = runSummaryAgent(
      contextOf({ files: Array.from({ length: 25 }, (_, i) => fileOf(`src/mod${i}/file.ts`, ["x"])) })
    );

    expect(small.output_markdown).toContain("**Complexity score:** Low");
    expect(large.output_markdown).toContain("**Complexity score:** High");
  });

  it("says so plainly when nothing changed", () => {
    const envelope = runSummaryAgent(contextOf({ files: [] }));
    expect(envelope.output_markdown).toContain("No files changed.");
  });
});

describe("llmPassEnabled", () => {
  const withEnv = (env: Record<string, string | undefined>, run: () => void) => {
    const saved = { PR_AGENT_LLM: process.env.PR_AGENT_LLM, ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY };
    Object.assign(process.env, env);
    for (const [key, value] of Object.entries(env)) {
      if (value === undefined) delete process.env[key];
    }
    try {
      run();
    } finally {
      Object.assign(process.env, saved);
      for (const [key, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[key];
      }
    }
  };

  it("is off by default — the deterministic pipeline must not depend on a key", () => {
    withEnv({ PR_AGENT_LLM: undefined, ANTHROPIC_API_KEY: "sk-ant-whatever" }, () => {
      expect(llmPassEnabled()).toBe(false);
    });
  });

  it("stays off when the flag is set but no key is available", () => {
    withEnv({ PR_AGENT_LLM: "1", ANTHROPIC_API_KEY: undefined }, () => {
      expect(llmPassEnabled()).toBe(false);
    });
  });

  it("turns on only with both the flag and a key", () => {
    withEnv({ PR_AGENT_LLM: "1", ANTHROPIC_API_KEY: "sk-ant-whatever" }, () => {
      expect(llmPassEnabled()).toBe(true);
    });
  });

  it("accepts the usual truthy spellings and rejects 0", () => {
    withEnv({ PR_AGENT_LLM: "true", ANTHROPIC_API_KEY: "k" }, () => expect(llmPassEnabled()).toBe(true));
    withEnv({ PR_AGENT_LLM: "on", ANTHROPIC_API_KEY: "k" }, () => expect(llmPassEnabled()).toBe(true));
    withEnv({ PR_AGENT_LLM: "0", ANTHROPIC_API_KEY: "k" }, () => expect(llmPassEnabled()).toBe(false));
  });
});
