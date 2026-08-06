// zod/v4 — the schema shape the Anthropic SDK's structured-output helper expects.
// The MCP tool definitions elsewhere in this package stay on the v3 API; zod 3.25
// ships both, so the two coexist without a second dependency.
import { z } from "zod/v4";
import { Finding, PRContext } from "./types";

/**
 * Optional LLM pass — the one place in this codebase that calls a model.
 *
 * The deterministic agents stay deterministic: this runs *after* them, reads
 * their findings plus the diff, and returns two things regex cannot produce —
 * observations about logic and intent, and a false-positive verdict on the rule
 * engine's own findings. It never blocks a review: disabled by default, and any
 * failure (no key, network, refusal, malformed reply) returns null and the
 * review completes exactly as it would have without it.
 *
 * Enable with PR_AGENT_LLM=1 and an ANTHROPIC_API_KEY.
 */

const MODEL = process.env.PR_AGENT_LLM_MODEL?.trim() || "claude-opus-5";

/** Diff characters sent to the model. Keeps a huge PR from blowing up one request. */
const MAX_DIFF_CHARS = 60_000;

/** Findings offered for triage. Beyond this the section is noise anyway. */
const MAX_FINDINGS = 40;

const TriageSchema = z.object({
  observations: z.array(
    z.object({
      file: z.string(),
      line: z.number(),
      issue: z.string(),
      why_it_matters: z.string()
    })
  ),
  dismissals: z.array(
    z.object({
      index: z.number(),
      reason: z.string()
    })
  )
});

export type TriageResult = z.infer<typeof TriageSchema>;

export interface LlmPassResult extends TriageResult {
  model: string;
  durationMs: number;
}

/** True when the pass is switched on and has a key to use. */
export function llmPassEnabled(): boolean {
  const flag = (process.env.PR_AGENT_LLM ?? "").trim().toLowerCase();
  const on = flag === "1" || flag === "true" || flag === "on" || flag === "yes";
  return on && Boolean(process.env.ANTHROPIC_API_KEY?.trim());
}

const SYSTEM_PROMPT = [
  "You are the second pass of a pull request review. A deterministic rule engine has already",
  "scanned the diff with regular expressions and reported its findings to you.",
  "",
  "Do two jobs, and only these two:",
  "",
  "1. observations — problems in the added lines that pattern matching structurally cannot find:",
  "   logic errors, missing edge cases, off-by-one and boundary mistakes, incorrect error handling,",
  "   resource leaks, race conditions, and code whose behaviour contradicts its name or comment.",
  "   Report only what you can point at in the diff, with the file and the line number as shown.",
  "   Do not report style, naming taste, formatting, or anything the rule engine already found.",
  "",
  "2. dismissals — findings from the list below that are false positives. Use the finding's index.",
  "   Dismiss only when the diff gives you a concrete reason: the value is a documented placeholder,",
  "   the flagged input is already validated upstream in the same diff, the construct is unreachable,",
  "   or the match is plainly textual (a URL inside a comment, a rule definition, a test fixture).",
  "   Uncertainty is not a reason to dismiss — leave it standing and say nothing.",
  "",
  "An empty array for either field is a good answer when there is nothing to say."
].join("\n");

function truncateDiff(context: PRContext): string {
  const parts: string[] = [];
  let budget = MAX_DIFF_CHARS;

  for (const file of context.files) {
    if (budget <= 0) {
      parts.push(`\n… ${context.files.length - parts.length} more file(s) omitted for length.`);
      break;
    }
    const header = `\n--- ${file.filename} (${file.status}, +${file.additions}/-${file.deletions})\n`;
    const patch = file.patch.length > budget ? `${file.patch.slice(0, budget)}\n… patch truncated` : file.patch;
    parts.push(header + patch);
    budget -= header.length + patch.length;
  }

  return parts.join("");
}

function buildUserPrompt(context: PRContext, findings: Finding[]): string {
  const findingList = findings.length
    ? findings
        .map((finding, index) => `[${index}] ${finding.severity} ${finding.file}:${finding.line} (${finding.category}) — ${finding.issue}`)
        .join("\n")
    : "(none)";

  return [
    `Pull request #${context.prNumber}: ${context.title}`,
    context.body ? `\nDescription:\n${context.body.slice(0, 2000)}` : "",
    "\nFindings already reported by the rule engine:",
    findingList,
    "\nDiff (added lines are prefixed with +; line numbers in your output must refer to the new file):",
    truncateDiff(context)
  ].join("\n");
}

/**
 * Runs the pass. Returns null whenever it is disabled or anything goes wrong —
 * callers treat a null as "this review has no LLM section" and carry on.
 */
export async function runLlmPass(context: PRContext, findings: Finding[]): Promise<LlmPassResult | null> {
  if (!llmPassEnabled()) {
    return null;
  }

  const start = Date.now();
  const offered = findings.slice(0, MAX_FINDINGS);

  try {
    // Imported lazily so the MCP server starts, and the CLI runs, without the
    // SDK installed at all — the deterministic path must never depend on it.
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const { zodOutputFormat } = await import("@anthropic-ai/sdk/helpers/zod.js");

    const client = new Anthropic();
    const response = await client.messages.parse({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      thinking: { type: "adaptive" },
      messages: [{ role: "user", content: buildUserPrompt(context, offered) }],
      output_config: { format: zodOutputFormat(TriageSchema) }
    });

    if (response.stop_reason === "refusal") {
      console.error("[pr-agent] LLM pass declined this diff; continuing with the deterministic report.");
      return null;
    }

    const parsed = response.parsed_output;
    if (!parsed) {
      return null;
    }

    // Apply the dismissals to the findings the caller handed us. The rule engine's
    // markdown is untouched — a dismissed finding is annotated, never deleted, so a
    // reviewer can always see what was dismissed and disagree.
    for (const dismissal of parsed.dismissals) {
      const finding = offered[dismissal.index];
      if (finding) {
        finding.dismissed = true;
        finding.dismissedReason = dismissal.reason;
      }
    }

    return { ...parsed, model: MODEL, durationMs: Date.now() - start };
  } catch (error) {
    console.error(`[pr-agent] LLM pass failed (review continues without it): ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

/** Renders the pass's own section. Never touches the deterministic sections. */
export function renderLlmSection(result: LlmPassResult): string {
  const lines: string[] = [
    "## 🤖 LLM Review Pass",
    "",
    `_Model: \`${result.model}\` · ${(result.durationMs / 1000).toFixed(1)}s · advisory only — the decision above is deterministic._`,
    ""
  ];

  if (result.observations.length === 0) {
    lines.push("**Observations:** none beyond the rule engine.", "");
  } else {
    lines.push("**Observations:**");
    for (const observation of result.observations) {
      lines.push(`- \`${observation.file}:${observation.line}\` — ${observation.issue}`);
      lines.push(`  *Why it matters:* ${observation.why_it_matters}`);
    }
    lines.push("");
  }

  if (result.dismissals.length > 0) {
    lines.push(`**Likely false positives (${result.dismissals.length}):** flagged for triage, not removed from the report above.`);
    for (const dismissal of result.dismissals) {
      lines.push(`- finding #${dismissal.index} — ${dismissal.reason}`);
    }
    lines.push("");
  }

  return lines.join("\n").trimEnd();
}
