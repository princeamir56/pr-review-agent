import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { copyFileSync, mkdirSync, readdirSync, unlinkSync } from "node:fs";
import * as path from "node:path";

const run = promisify(execFile);

/** Values of PR_AGENT_AUTO_SCAN that turn the feature off. */
const DISABLED = new Set(["0", "false", "off", "no"]);

/** Per-scanner wall-clock cap (ms). Rule downloads + image pulls can be slow. */
const SCANNER_TIMEOUT = 300_000;

export interface ScanOptions {
  /** Directory holding the PR's actual files to scan (from `materializePrFiles`). */
  scanDir?: string;
  /** PR number, for log lines only. */
  prNumber?: number;
}

/**
 * Best-effort: run Semgrep, Gitleaks and Trivy in Docker against `opts.scanDir` (the
 * PR's materialized files), writing their SARIF into `<cwd>/sarif` (or
 * `PR_AGENT_SARIF_DIR`) so the Security agent folds them in automatically.
 *
 * Deliberately forgiving:
 *   - Disabled entirely with `PR_AGENT_AUTO_SCAN=0`.
 *   - If `PR_AGENT_SARIF_DIR` is set and already has SARIF (CI wrote it), do nothing.
 *   - If Docker isn't installed / running, no-op and fall back to the regex engine.
 *   - If no scan directory was prepared, skip (rather than scan the wrong tree).
 *   - Any scanner failing is non-fatal; the review still completes.
 *
 * Logs go to stderr only (stdout is reserved for the MCP JSON-RPC protocol).
 */
export async function autoRunScanners(cwd: string, opts: ScanOptions = {}): Promise<void> {
  const flag = process.env.PR_AGENT_AUTO_SCAN?.trim().toLowerCase();
  if (flag && DISABLED.has(flag)) {
    return;
  }

  // Two ownership models:
  //  - EXPLICIT dir (PR_AGENT_SARIF_DIR set, e.g. by CI): an outside process wrote the
  //    SARIF for this checkout. If it's there, trust it and don't rescan.
  //  - DEFAULT dir (<cwd>/sarif): we own it. Stale SARIF from a previous review must
  //    not be reused, so we always clear it and rescan fresh.
  const explicitDir = !!process.env.PR_AGENT_SARIF_DIR?.trim();
  const sarifDir = explicitDir ? process.env.PR_AGENT_SARIF_DIR!.trim() : path.join(cwd, "sarif");

  if (explicitDir && hasSarif(sarifDir)) {
    return; // CI/external already produced SARIF for this checkout.
  }

  if (!(await dockerAvailable())) {
    if (!explicitDir) {
      clearSarif(sarifDir);
    }
    console.error(
      "[pr-agent] External scanners skipped: Docker not available. " +
        "Install Docker Desktop, or set PR_AGENT_AUTO_SCAN=0 to silence this. Using regex engine only."
    );
    return;
  }

  mkdirSync(sarifDir, { recursive: true });
  if (!explicitDir) {
    clearSarif(sarifDir);
  }

  const scanDir = opts.scanDir;
  if (!scanDir) {
    console.error(
      "[pr-agent] External scanners skipped: could not prepare the PR's files to scan. Using regex engine only."
    );
    return;
  }

  // Scanners write SARIF into <scanDir>/sarif; we copy it out to sarifDir afterward.
  const scanSarif = path.join(scanDir, "sarif");
  mkdirSync(scanSarif, { recursive: true });
  clearSarif(scanSarif);

  const label = opts.prNumber ? `PR #${opts.prNumber}` : "the PR";
  console.error(`[pr-agent] Scanning ${label} files with Semgrep + Gitleaks + Trivy via Docker (first run pulls images)…`);

  await Promise.all([
    docker(
      ["run", "--rm", "-v", `${scanDir}:/src`, "-w", "/src", "semgrep/semgrep",
        "semgrep", "scan", "--config=p/default", "--config=p/security-audit", "--config=p/secrets",
        "--sarif", "--output=sarif/semgrep.sarif"],
      "semgrep"
    ),
    docker(
      ["run", "--rm", "-v", `${scanDir}:/repo`, "zricethezav/gitleaks:latest",
        "detect", "--source=/repo", "--no-git",
        "--report-format", "sarif", "--report-path", "/repo/sarif/gitleaks.sarif", "--exit-code", "0"],
      "gitleaks"
    ),
    docker(
      ["run", "--rm", "-v", `${scanDir}:/repo`, "aquasec/trivy:latest",
        "fs", "/repo", "--scanners", "vuln,secret,misconfig", "--skip-dirs", "node_modules,.git,sarif",
        "--format", "sarif", "--output", "/repo/sarif/trivy.sarif"],
      "trivy"
    )
  ]);

  collectSarif(scanSarif, sarifDir);
  process.env.PR_AGENT_SARIF_DIR = sarifDir;
}

async function docker(args: string[], label: string): Promise<void> {
  try {
    await run("docker", args, { timeout: SCANNER_TIMEOUT, maxBuffer: 32 * 1024 * 1024 });
  } catch (error) {
    // Non-fatal: a scanner failing (or finding nothing) must not break the review.
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`[pr-agent] ${label} scan did not complete: ${message}`);
  }
}

function hasSarif(dir: string): boolean {
  try {
    return readdirSync(dir).some((file) => file.toLowerCase().endsWith(".sarif"));
  } catch {
    return false;
  }
}

/** Delete any `*.sarif` in `dir` so a fresh scan isn't mixed with stale results. */
function clearSarif(dir: string): void {
  try {
    for (const file of readdirSync(dir)) {
      if (file.toLowerCase().endsWith(".sarif")) {
        unlinkSync(path.join(dir, file));
      }
    }
  } catch {
    // dir doesn't exist yet / unreadable — nothing to clear.
  }
}

/** Copy every `*.sarif` produced in the scan dir back to the dir the agent reads. */
function collectSarif(from: string, to: string): void {
  try {
    mkdirSync(to, { recursive: true });
    for (const file of readdirSync(from)) {
      if (file.toLowerCase().endsWith(".sarif")) {
        copyFileSync(path.join(from, file), path.join(to, file));
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message.split("\n")[0] : String(error);
    console.error(`[pr-agent] Could not collect SARIF: ${message}`);
  }
}

async function dockerAvailable(): Promise<boolean> {
  try {
    await run("docker", ["version", "--format", "{{.Server.Version}}"], { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}
