/** Typed fetch client for the web-server API. */

export type RiskLevel = "clean" | "low" | "medium" | "high" | "critical";
export type AgentName = "summary" | "security" | "documentation";
export type AgentStatus = "complete" | "error" | "skipped";

export interface AgentEnvelope {
  agent: AgentName;
  pr_number: number;
  status: AgentStatus;
  risk_level: RiskLevel;
  output_markdown: string;
  findings_count: number;
  processing_time_ms: number;
}

export interface OpenPR {
  number: number;
  title: string;
  author: string;
  createdAt: string;
  headBranch: string;
  changedFiles: number | null;
  hasReport: boolean;
  reportPath: string | null;
}

export interface ClosedPR extends Omit<OpenPR, "hasReport" | "reportPath"> {
  closedAt: string | null;
  merged: boolean;
  hasReport: boolean;
  reportPath: string | null;
}

export interface PRDetail {
  owner: string;
  repo: string;
  number: number;
  title: string;
  body: string;
  author: string;
  baseBranch: string;
  headBranch: string;
  headSha: string;
  htmlUrl: string;
  commits: string[];
  files: Array<{ filename: string; status: string; additions: number; deletions: number; changes: number; patch: string }>;
}

export interface ReviewResult {
  prNumber: number;
  title: string;
  owner: string;
  repo: string;
  riskLevel: RiskLevel;
  recommendation: "APPROVE" | "REQUEST CHANGES" | "NEEDS DISCUSSION";
  docPath: string;
  commentUrl: string | null;
  envelopes: AgentEnvelope[];
}

export interface ReportSummary {
  name: string;
  prNumber: number | null;
  date: string | null;
  size: number;
  modifiedAt: string;
}

export type ConfigView = Record<
  "GITHUB_TOKEN" | "GITHUB_OWNER" | "GITHUB_REPO" | "ANTHROPIC_API_KEY" | "MCP_SERVER_PORT" | "OLLAMA_MODEL" | "OLLAMA_URL",
  { set: boolean; value: string }
>;

async function j<T>(res: Response): Promise<T> {
  const data = (await res.json()) as { ok: boolean; error?: string } & Record<string, unknown>;
  if (!res.ok || !data.ok) {
    throw new Error(data.error ?? `Request failed (${res.status})`);
  }
  return data as unknown as T;
}

export const api = {
  repo: () => fetch("/api/prs/repo").then(j<{ ok: true; owner: string; repo: string }>),

  listOpen: () => fetch("/api/prs/open").then(j<{ ok: true; owner: string; repo: string; prs: OpenPR[] }>),

  listClosed: () => fetch("/api/prs/closed").then(j<{ ok: true; owner: string; repo: string; prs: ClosedPR[] }>),

  getPr: (n: number) => fetch(`/api/prs/${n}`).then(j<{ ok: true; pr: PRDetail; report: { hasReport: boolean; reportPath: string | null } }>),

  status: (n: number) => fetch(`/api/prs/${n}/status`).then(j<{ ok: true; prNumber: number; hasReport: boolean; reportPath: string | null }>),

  runReview: (n: number, agents: AgentName[], postComment: boolean) =>
    fetch(`/api/review/${n}/run`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agents, postComment })
    }).then(j<{ ok: true; result: ReviewResult }>),

  postComment: (n: number) =>
    fetch(`/api/review/${n}/postComment`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" })
      .then(j<{ ok: true; url: string; reportPath: string }>),

  listReports: () => fetch("/api/reports").then(j<{ ok: true; reports: ReportSummary[] }>),

  getReport: (name: string) => fetch(`/api/reports/${encodeURIComponent(name)}`).then(j<{ ok: true; name: string; content: string }>),

  getSettings: () => fetch("/api/settings").then(j<{ ok: true; config: ConfigView; keys: string[] }>),

  saveSettings: (update: Partial<Record<keyof ConfigView, string>>) =>
    fetch("/api/settings", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(update) })
      .then(j<{ ok: true; config: ConfigView }>),

  testSettings: (probe: Partial<Record<"GITHUB_TOKEN" | "GITHUB_OWNER" | "GITHUB_REPO", string>>) =>
    fetch("/api/settings/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(probe) })
      .then(j<{ ok: true; user: { login: string }; repo: null | { full_name: string; private: boolean } }>)
};
