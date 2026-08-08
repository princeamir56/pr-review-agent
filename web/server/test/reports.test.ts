import { describe, expect, it } from "vitest";

/**
 * Mirrors the patterns in src/routes/reports.ts. Kept in sync by hand — if you
 * change them there, change them here. Extracting them into a shared module
 * would be the alternative, but the route file is the single consumer.
 */
const SAFE_NAME = /^PR-\d+-\d{4}-\d{2}-\d{2}(-[0-9a-f]{7,40})?\.md$/;
const PARSE = /^PR-(\d+)-(\d{4}-\d{2}-\d{2})(?:-[0-9a-f]{7,40})?\.md$/;

describe("report filename matching", () => {
  it("accepts the current PR-<n>-<date>-<sha>.md form the orchestrator writes", () => {
    // Regression: the dashboard listed zero reports because its pattern predated
    // the -<sha> suffix, so no real report ever matched.
    expect(SAFE_NAME.test("PR-2-2026-08-08-46844d2.md")).toBe(true);
  });

  it("still accepts the older PR-<n>-<date>.md form", () => {
    expect(SAFE_NAME.test("PR-2-2026-08-08.md")).toBe(true);
  });

  it("accepts a full 40-char sha", () => {
    expect(SAFE_NAME.test(`PR-10-2026-08-08-${"a".repeat(40)}.md`)).toBe(true);
  });

  it("extracts prNumber and date from the sha-suffixed form", () => {
    const m = PARSE.exec("PR-2-2026-08-08-46844d2.md");
    expect(m).not.toBeNull();
    expect(Number(m?.[1])).toBe(2);
    expect(m?.[2]).toBe("2026-08-08");
  });

  it("rejects path traversal", () => {
    for (const bad of [
      "../../../etc/passwd",
      "PR-1-2026-08-08.md/../../secret",
      "..\\..\\windows\\system32",
      "/etc/passwd",
      "PR-1-2026-08-08-../.md"
    ]) {
      expect(SAFE_NAME.test(bad)).toBe(false);
    }
  });

  it("rejects non-report filenames", () => {
    for (const bad of [".env", "README.md", "PR-.md", "PR-abc-2026-08-08.md", "PR-1-08-08.md"]) {
      expect(SAFE_NAME.test(bad)).toBe(false);
    }
  });

  it("rejects a non-hex sha segment", () => {
    expect(SAFE_NAME.test("PR-1-2026-08-08-zzzzzzz.md")).toBe(false);
  });
});
