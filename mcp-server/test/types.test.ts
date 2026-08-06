import { describe, expect, it } from "vitest";
import { detectLanguage, highestRisk, parseAddedLines } from "../src/agents/types";

describe("parseAddedLines", () => {
  it("returns nothing for an empty patch", () => {
    expect(parseAddedLines("")).toEqual([]);
  });

  it("numbers added lines from the hunk header", () => {
    const patch = ["@@ -10,3 +10,4 @@", " context", "+added one", "+added two", " trailing"].join("\n");

    expect(parseAddedLines(patch)).toEqual([
      { line: 11, content: "added one" },
      { line: 12, content: "added two" }
    ]);
  });

  it("does not let removed lines advance the new-file counter", () => {
    const patch = ["@@ -1,4 +1,2 @@", "-gone", "-also gone", "+replacement"].join("\n");

    expect(parseAddedLines(patch)).toEqual([{ line: 1, content: "replacement" }]);
  });

  it("restarts numbering at each hunk", () => {
    const patch = ["@@ -1,1 +1,1 @@", "+first", "@@ -50,1 +80,1 @@", "+second"].join("\n");

    expect(parseAddedLines(patch)).toEqual([
      { line: 1, content: "first" },
      { line: 80, content: "second" }
    ]);
  });

  it("ignores the file header lines that start with +++ and ---", () => {
    const patch = ["--- a/file.ts", "+++ b/file.ts", "@@ -1,0 +1,1 @@", "+real line"].join("\n");

    expect(parseAddedLines(patch)).toEqual([{ line: 1, content: "real line" }]);
  });

  it("handles a single-line hunk header with no count", () => {
    const patch = ["@@ -0,0 +7 @@", "+lonely"].join("\n");

    expect(parseAddedLines(patch)).toEqual([{ line: 7, content: "lonely" }]);
  });
});

describe("highestRisk", () => {
  it("is clean for an empty list", () => {
    expect(highestRisk([])).toBe("clean");
  });

  it("returns the highest level regardless of order", () => {
    expect(highestRisk(["low", "critical", "medium"])).toBe("critical");
    expect(highestRisk(["medium", "low"])).toBe("medium");
    expect(highestRisk(["clean", "clean"])).toBe("clean");
  });
});

describe("detectLanguage", () => {
  it.each([
    ["api/main.py", "python"],
    ["src/index.ts", "typescript"],
    ["src/App.tsx", "typescript"],
    ["scripts/build.mjs", "javascript"],
    ["Service.java", "java"],
    ["README.md", "other"]
  ])("maps %s to %s", (filename, expected) => {
    expect(detectLanguage(filename)).toBe(expected);
  });

  it("is case insensitive", () => {
    expect(detectLanguage("SCRIPT.PY")).toBe("python");
  });
});
