import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // The suite is pure — no network, no Docker, no GitHub token. It must stay
    // that way so `npm test` can gate CI without any secrets.
    testTimeout: 10_000,
    coverage: {
      provider: "v8",
      include: ["src/agents/**", "src/orchestrator.ts", "src/github/githubClient.ts"],
      reporter: ["text", "lcov"]
    }
  }
});
