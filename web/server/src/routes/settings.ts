import { Router, Request, Response } from "express";
import { Octokit } from "@octokit/rest";
import { CONFIG_KEYS, ConfigKey, hasSecretKey, loadConfig, saveConfig, toClientSafe } from "../config/secureStore";
import { formatError } from "../../../../mcp-server/src/github/githubClient";

export const settingsRouter = Router();

settingsRouter.get("/", async (_req: Request, res: Response) => {
  const config = await loadConfig();
  // `secretsAvailable: false` tells the UI that secret fields cannot be saved
  // until WEB_SECRET_KEY is configured, rather than letting the save fail later.
  res.json({ ok: true, config: toClientSafe(config), keys: CONFIG_KEYS, secretsAvailable: hasSecretKey() });
});

settingsRouter.put("/", async (req: Request, res: Response) => {
  const body = req.body as Record<string, unknown>;
  const update: Partial<Record<ConfigKey, string>> = {};
  for (const key of CONFIG_KEYS) {
    const val = body[key];
    if (typeof val === "string") update[key] = val;
  }
  // Saving a secret without a key would throw inside deriveKey; report it as a
  // client-fixable configuration problem instead of a server fault.
  const writesSecret = update.GITHUB_TOKEN !== undefined || update.ANTHROPIC_API_KEY !== undefined;
  if (writesSecret && !hasSecretKey()) {
    res.status(400).json({
      ok: false,
      code: "WEB_SECRET_KEY_MISSING",
      error:
        "WEB_SECRET_KEY is not configured, so tokens cannot be encrypted. Add it to web/server/.env and restart the server."
    });
    return;
  }

  try {
    const merged = await saveConfig(update);
    res.json({ ok: true, config: toClientSafe(merged) });
  } catch (error) {
    res.status(500).json({ ok: false, error: formatError(error) });
  }
});

settingsRouter.post("/test", async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as { GITHUB_TOKEN?: string; GITHUB_OWNER?: string; GITHUB_REPO?: string };
  try {
    const config = await loadConfig();
    const token = (body.GITHUB_TOKEN && body.GITHUB_TOKEN.length > 0 ? body.GITHUB_TOKEN : config.GITHUB_TOKEN) ?? "";
    if (!token) throw new Error("GITHUB_TOKEN is not set.");
    const octokit = new Octokit({ auth: token, userAgent: "pr-review-agent-web/0.1.0" });
    const { data: user } = await octokit.users.getAuthenticated();
    const owner = body.GITHUB_OWNER ?? config.GITHUB_OWNER;
    const repo = body.GITHUB_REPO ?? config.GITHUB_REPO;
    let repoOk: null | { full_name: string; private: boolean } = null;
    if (owner && repo) {
      const { data } = await octokit.repos.get({ owner, repo });
      repoOk = { full_name: data.full_name, private: data.private };
    }
    res.json({ ok: true, user: { login: user.login }, repo: repoOk });
  } catch (error) {
    res.status(400).json({ ok: false, error: formatError(error) });
  }
});
