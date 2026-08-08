import express from "express";
import cors from "cors";
import { loadConfig, applyToProcessEnv } from "./config/secureStore";
import { checkEnv, reportEnv } from "./config/validateEnv";
import { prsRouter } from "./routes/prs";
import { reviewRouter } from "./routes/review";
import { reportsRouter } from "./routes/reports";
import { settingsRouter } from "./routes/settings";
import { metricsRouter } from "./routes/metrics";
import { attachSseClient } from "./sse";

async function main(): Promise<void> {
  // Merge persisted settings into process.env before any route touches
  // GitHubClient — and before validation, so a token stored via the Settings
  // page counts as configured.
  applyToProcessEnv(await loadConfig());

  if (!reportEnv(checkEnv())) {
    process.exit(1);
  }

  const app = express();
  app.use(cors());
  app.use(express.json({ limit: "1mb" }));

  app.get("/api/health", (_req, res) => res.json({ ok: true, service: "pr-review-agent-web-server" }));

  app.use("/api/prs", prsRouter);
  app.use("/api/review", reviewRouter);
  app.use("/api/reports", reportsRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/metrics", metricsRouter);

  app.get("/api/events", (_req, res) => attachSseClient(res));

  const port = Number(process.env.WEB_SERVER_PORT ?? 4000);
  app.listen(port, () => {
    console.log(`[web-server] listening on http://localhost:${port}`);
  });
}

main().catch((error: unknown) => {
  console.error(`[web-server] startup failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
