import { AgentEnvelope, PRContext } from "./types";

/**
 * Deterministic Summary agent. Produces the `## 📋 Summary` section from PR
 * metadata and diff statistics without requiring an LLM, so the pipeline runs
 * headless and in CI. The .github/agents/summary.agent.md file describes the
 * richer LLM-driven behavior used inside VS Code chat.
 */
export function runSummaryAgent(context: PRContext): AgentEnvelope {
  const start = Date.now();

  const totalAdditions = context.files.reduce((sum, file) => sum + file.additions, 0);
  const totalDeletions = context.files.reduce((sum, file) => sum + file.deletions, 0);
  const fileCount = context.files.length;

  const intent = inferIntent(context);
  const impactAreas = inferImpactAreas(context);
  const complexity = scoreComplexity(fileCount, totalAdditions + totalDeletions, impactAreas.length);
  const topFiles = [...context.files]
    .sort((a, b) => b.changes - a.changes)
    .slice(0, 5);

  const whatChanged = buildWhatChanged(context, fileCount, totalAdditions, totalDeletions);

  const lines: string[] = [
    "## 📋 Summary",
    "",
    `**What changed:** ${whatChanged}`,
    "",
    `**Why it exists:** \`${intent.label}\` — ${intent.reason}`,
    "",
    `**Impact areas:** ${impactAreas.length ? impactAreas.map((area) => `\`${area}\``).join(", ") : "Isolated change — no broad module impact detected."}`,
    "",
    `**Complexity score:** ${complexity.score} — ${complexity.justification}`,
    "",
    "**Files changed summary:**",
    ...(topFiles.length
      ? topFiles.map((file) => `- \`${file.filename}\` — ${describeFile(file)} (+${file.additions}/-${file.deletions})`)
      : ["- No files changed."])
  ];

  return {
    agent: "summary",
    pr_number: context.prNumber,
    status: "complete",
    risk_level: "low",
    output_markdown: lines.join("\n"),
    findings_count: fileCount,
    processing_time_ms: Date.now() - start
  };
}

function buildWhatChanged(context: PRContext, fileCount: number, additions: number, deletions: number): string {
  const title = context.title.trim();
  const scope = summarizeScope(context);
  const base = title ? `${title}.` : "Modifies the codebase.";
  return `${base} Touches ${fileCount} file${fileCount === 1 ? "" : "s"} (${scope}) with +${additions}/-${deletions} lines.`;
}

function summarizeScope(context: PRContext): string {
  const dirs = new Set<string>();
  for (const file of context.files) {
    const segments = file.filename.split("/");
    dirs.add(segments.length > 1 ? `${segments[0]}/` : "root");
  }
  const list = [...dirs].slice(0, 4).join(", ");
  return dirs.size > 4 ? `${list}, …` : list;
}

interface Intent {
  label: "bug fix" | "feature" | "refactor" | "config" | "hotfix" | "docs" | "test" | "chore";
  reason: string;
}

function inferIntent(context: PRContext): Intent {
  const haystack = `${context.title}\n${context.body}\n${context.commits.join("\n")}`.toLowerCase();
  const onlyDocs = context.files.length > 0 && context.files.every((f) => /\.(md|mdx|rst|txt)$/i.test(f.filename));
  const onlyTests = context.files.length > 0 && context.files.every((f) => /(\.test\.|\.spec\.|__tests__\/|\/tests?\/)/i.test(f.filename));
  const onlyConfig = context.files.length > 0 && context.files.every((f) => /(\.ya?ml|\.json|\.toml|\.ini|\.env|dockerfile)$/i.test(f.filename.toLowerCase()) || /\.(ya?ml|json|toml|ini)$/i.test(f.filename));

  if (/\bhotfix\b|\brevert\b|urgent/.test(haystack)) {
    return { label: "hotfix", reason: "title/commits indicate an urgent fix or revert." };
  }
  if (onlyDocs) {
    return { label: "docs", reason: "only documentation files changed." };
  }
  if (onlyTests) {
    return { label: "test", reason: "only test files changed." };
  }
  if (/\bfix\b|\bbug\b|\bpatch\b|resolve[sd]?\b|closes? #/.test(haystack)) {
    return { label: "bug fix", reason: "title/commits reference a fix or bug." };
  }
  if (/\brefactor\b|cleanup|rename|restructure|simplif/.test(haystack)) {
    return { label: "refactor", reason: "title/commits indicate restructuring without behavior change." };
  }
  if (onlyConfig) {
    return { label: "config", reason: "only configuration files changed." };
  }
  if (/\bchore\b|bump|dependenc|upgrade/.test(haystack)) {
    return { label: "chore", reason: "maintenance or dependency work." };
  }
  if (/\bfeat\b|feature|add(s|ed)?\b|introduce|implement|support/.test(haystack)) {
    return { label: "feature", reason: "title/commits describe new functionality." };
  }
  return { label: "feature", reason: "no explicit signal; defaulting based on net-additive changes." };
}

function inferImpactAreas(context: PRContext): string[] {
  const areas = new Set<string>();
  for (const file of context.files) {
    const parts = file.filename.split("/");
    if (parts.length >= 2) {
      areas.add(parts.slice(0, 2).join("/"));
    } else {
      areas.add(parts[0] ?? file.filename);
    }
  }
  return [...areas].slice(0, 6);
}

interface Complexity {
  score: "Low" | "Medium" | "High";
  justification: string;
}

function scoreComplexity(fileCount: number, totalChanges: number, areaCount: number): Complexity {
  const detail = `${fileCount} file${fileCount === 1 ? "" : "s"}, ${totalChanges} changed lines, ${areaCount} impact area${areaCount === 1 ? "" : "s"}.`;
  if (fileCount > 20 || totalChanges > 600 || areaCount > 5) {
    return { score: "High", justification: detail };
  }
  if (fileCount > 5 || totalChanges > 150 || areaCount > 2) {
    return { score: "Medium", justification: detail };
  }
  return { score: "Low", justification: detail };
}

function describeFile(file: { status: string; filename: string }): string {
  const verb = file.status === "added"
    ? "new file"
    : file.status === "removed"
      ? "deleted"
      : file.status === "renamed"
        ? "renamed"
        : "modified";
  const ext = file.filename.split(".").pop() ?? "";
  return `${verb}${ext ? ` (${ext})` : ""}`;
}
