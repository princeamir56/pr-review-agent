import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["test/**/*.test.ts"],
    environment: "node",
    // Same rule as the mcp-server suite: pure, no network, no secrets, so it can
    // gate CI unattended.
    testTimeout: 10_000
  }
});
