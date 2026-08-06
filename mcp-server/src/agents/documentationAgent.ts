import { AgentEnvelope, PRContext, detectLanguage, parseAddedLines } from "./types";

interface DetectedFunction {
  file: string;
  line: number;
  name: string;
  params: string[];
  language: ReturnType<typeof detectLanguage>;
  documented: boolean;
}

/**
 * Deterministic Documentation agent. Detects undocumented functions, README impact,
 * and changelog needs, then emits the `## 📚 Documentation` section with ready-to-paste
 * docstrings for the top functions.
 */
export function runDocumentationAgent(context: PRContext): AgentEnvelope {
  const start = Date.now();

  const functions = detectFunctions(context);
  const undocumented = functions.filter((fn) => !fn.documented);
  const readme = assessReadmeImpact(context);
  const changelog = buildChangelogEntry(context);
  const docstrings = functions
    .sort((a, b) => b.params.length - a.params.length)
    .slice(0, 3)
    .map((fn) => renderDocstring(fn));

  const lines: string[] = [
    "## 📚 Documentation",
    "",
    "**Missing docstrings/JSDoc:**",
    ...(undocumented.length
      ? undocumented.slice(0, 12).map((fn) => `- \`${fn.file}\` → \`${fn.name}()\``)
      : ["- None — all detected public symbols are documented."]),
    "",
    `**README impact:** ${readme}`,
    "",
    "**Changelog entry:**",
    "```markdown",
    changelog,
    "```",
    "",
    "**Auto-generated docstrings:**",
    ...(docstrings.length
      ? docstrings
      : ["_No function declarations detected in the diff._"])
  ];

  return {
    agent: "documentation",
    pr_number: context.prNumber,
    status: "complete",
    risk_level: "low",
    output_markdown: lines.join("\n"),
    findings_count: undocumented.length,
    processing_time_ms: Date.now() - start
  };
}

function detectFunctions(context: PRContext): DetectedFunction[] {
  const found: DetectedFunction[] = [];

  for (const file of context.files) {
    const language = detectLanguage(file.filename);
    if (language === "other") {
      continue;
    }

    const added = parseAddedLines(file.patch);
    for (let i = 0; i < added.length; i += 1) {
      const current = added[i];
      if (!current) {
        continue;
      }
      const signature = matchSignature(current.content, language);
      if (!signature) {
        continue;
      }

      const prev = i > 0 ? added[i - 1]?.content ?? "" : "";
      const documented = isDocComment(prev, language);

      found.push({
        file: file.filename,
        line: current.line,
        name: signature.name,
        params: signature.params,
        language,
        documented
      });
    }
  }

  // Deduplicate by file + name (a function may appear across multiple hunks).
  const seen = new Set<string>();
  return found.filter((fn) => {
    const key = `${fn.file}:${fn.name}`;
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

interface Signature {
  name: string;
  params: string[];
}

function matchSignature(line: string, language: DetectedFunction["language"]): Signature | null {
  const trimmed = line.trim();

  if (language === "python") {
    const match = /^def\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(trimmed);
    if (match && match[1]) {
      return { name: match[1], params: splitParams(match[2] ?? "").filter((p) => p !== "self" && p !== "cls") };
    }
    return null;
  }

  if (language === "java") {
    const match = /\b(?:public|private|protected)\s+(?:static\s+)?(?:[\w<>[\],\s]+)\s+([A-Za-z_]\w*)\s*\(([^)]*)\)/.exec(trimmed);
    if (match && match[1] && match[1] !== "new") {
      return { name: match[1], params: splitParams(match[2] ?? "").map((p) => p.split(/\s+/).pop() ?? p) };
    }
    return null;
  }

  // typescript / javascript
  const fnDecl = /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)\s*\(([^)]*)\)/.exec(trimmed);
  if (fnDecl && fnDecl[1]) {
    return { name: fnDecl[1], params: splitParams(fnDecl[2] ?? "") };
  }
  const arrowDecl = /^(?:export\s+)?(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s+)?\(([^)]*)\)\s*(?::[^=]+)?=>/.exec(trimmed);
  if (arrowDecl && arrowDecl[1]) {
    return { name: arrowDecl[1], params: splitParams(arrowDecl[2] ?? "") };
  }
  const methodDecl = /^(?:public|private|protected|static|async|\s)*([A-Za-z_$][\w$]*)\s*\(([^)]*)\)\s*(?::[^={]+)?\{/.exec(trimmed);
  if (methodDecl && methodDecl[1] && !RESERVED.has(methodDecl[1])) {
    return { name: methodDecl[1], params: splitParams(methodDecl[2] ?? "") };
  }
  return null;
}

const RESERVED = new Set(["if", "for", "while", "switch", "catch", "return", "function", "constructor"]);

function splitParams(raw: string): string[] {
  return raw
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => part.replace(/[:=].*$/, "").replace(/[?.]/g, "").trim())
    .filter(Boolean);
}

function isDocComment(previousLine: string, language: DetectedFunction["language"]): boolean {
  const trimmed = previousLine.trim();
  if (language === "python") {
    return trimmed.startsWith('"""') || trimmed.startsWith("'''");
  }
  return trimmed.startsWith("*") || trimmed.startsWith("/**") || trimmed.startsWith("//") || trimmed.endsWith("*/");
}

function assessReadmeImpact(context: PRContext): string {
  const readmeTouched = context.files.some((file) => /readme(\.md)?$/i.test(file.filename));
  const reasons: string[] = [];

  for (const file of context.files) {
    for (const { content } of parseAddedLines(file.patch)) {
      if (/^[A-Z][A-Z0-9_]+\s*=/.test(content.trim()) || /process\.env\.[A-Z0-9_]+/.test(content)) {
        reasons.push("new/changed environment variable");
      }
      if (/"scripts"|"bin"/.test(content) || /^\s*"[\w:-]+"\s*:\s*".+"/.test(content) && /package\.json$/i.test(file.filename)) {
        reasons.push("new npm script/command");
      }
    }
    if (/\.vscode\/(tasks|settings)\.json$/i.test(file.filename)) {
      reasons.push("new VS Code commands/tasks");
    }
  }

  const unique = [...new Set(reasons)];
  if (unique.length === 0) {
    return "No README update required.";
  }
  if (readmeTouched) {
    return `README was updated in this PR ✅ (covers: ${unique.join(", ")}).`;
  }
  return `⚠️ Update recommended — ${unique.join(", ")} introduced but README not touched.`;
}

function buildChangelogEntry(context: PRContext): string {
  const title = context.title.trim() || "Update";
  const haystack = `${context.title} ${context.commits.join(" ")}`.toLowerCase();

  let bucket: "Added" | "Changed" | "Fixed" | "Removed" = "Changed";
  if (/\bfix\b|\bbug\b|resolve/.test(haystack)) {
    bucket = "Fixed";
  } else if (/\badd\b|feat|introduce|implement|new\b/.test(haystack)) {
    bucket = "Added";
  } else if (/\bremove\b|delete|drop\b/.test(haystack)) {
    bucket = "Removed";
  }

  return ["## [Unreleased]", `### ${bucket}`, `- ${title}.`].join("\n");
}

function renderDocstring(fn: DetectedFunction): string {
  if (fn.language === "python") {
    const args = fn.params.length
      ? ["    Args:", ...fn.params.map((p) => `        ${p}: Description of ${p}.`)].join("\n")
      : "";
    return [
      "```python",
      `def ${fn.name}(...):`,
      '    """One-line summary of what the function does.',
      "",
      args,
      args ? "" : "",
      "    Returns:",
      "        Description of the return value.",
      '    """',
      "```"
    ].filter((l) => l !== undefined).join("\n");
  }

  if (fn.language === "java") {
    const params = fn.params.map((p) => ` * @param ${p} description of ${p}`).join("\n");
    return [
      "```java",
      "/**",
      ` * One-line summary of ${fn.name}.`,
      params,
      " * @return description of the return value",
      " */",
      "```"
    ].filter(Boolean).join("\n");
  }

  // JSDoc for JS/TS
  const params = fn.params.map((p) => ` * @param ${p} - Description of ${p}.`).join("\n");
  return [
    `\`\`\`${fn.language === "typescript" ? "typescript" : "javascript"}`,
    "/**",
    ` * One-line summary of ${fn.name}.`,
    params,
    " * @returns Description of the return value.",
    " */",
    "```"
  ].filter(Boolean).join("\n");
}
