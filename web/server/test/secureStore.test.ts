import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { existsSync } from "node:fs";
import * as path from "node:path";
import { hasSecretKey, loadConfig, saveConfig } from "../src/config/secureStore";
import { checkEnv } from "../src/config/validateEnv";
import { findAgentRoot } from "../src/context";

const KEY = "test-key-that-is-long-enough-0123456789";
const original = process.env.WEB_SECRET_KEY;

beforeEach(() => {
  process.env.WEB_SECRET_KEY = KEY;
});

afterEach(() => {
  if (original === undefined) {
    delete process.env.WEB_SECRET_KEY;
  } else {
    process.env.WEB_SECRET_KEY = original;
  }
});

describe("WEB_SECRET_KEY handling", () => {
  it("reports a usable key as available", () => {
    expect(hasSecretKey()).toBe(true);
  });

  it("treats a missing key as unavailable", () => {
    delete process.env.WEB_SECRET_KEY;
    expect(hasSecretKey()).toBe(false);
  });

  it("treats a too-short key as unavailable rather than silently accepting it", () => {
    process.env.WEB_SECRET_KEY = "short";
    expect(hasSecretKey()).toBe(false);
  });

  it("refuses to write a secret without a key, instead of encrypting under a default", async () => {
    // Regression guard: an earlier version fell back to sha256("pr-review-agent:dev-key"),
    // a constant published in this repo, which made stored tokens trivially decryptable.
    delete process.env.WEB_SECRET_KEY;
    await expect(saveConfig({ GITHUB_TOKEN: "some-token-value" })).rejects.toThrow(/WEB_SECRET_KEY/);
  });

  it("still loads non-secret config when no key is set", async () => {
    delete process.env.WEB_SECRET_KEY;
    // Must not throw: the dashboard has to render so the user can fix the config.
    await expect(loadConfig()).resolves.toBeTypeOf("object");
  });
});

describe("startup env validation", () => {
  it("flags a missing WEB_SECRET_KEY as fatal", () => {
    delete process.env.WEB_SECRET_KEY;
    const fatal = checkEnv().filter((p) => p.fatal);
    expect(fatal.some((p) => p.message.includes("WEB_SECRET_KEY"))).toBe(true);
  });

  it("does not treat a missing GITHUB_TOKEN as fatal — it is settable from the UI", () => {
    const token = process.env.GITHUB_TOKEN;
    delete process.env.GITHUB_TOKEN;
    try {
      const problems = checkEnv();
      const tokenProblem = problems.find((p) => p.message.includes("GITHUB_TOKEN"));
      expect(tokenProblem).toBeDefined();
      expect(tokenProblem?.fatal).toBe(false);
    } finally {
      if (token !== undefined) process.env.GITHUB_TOKEN = token;
    }
  });

  it("rejects a non-numeric WEB_SERVER_PORT", () => {
    const prev = process.env.WEB_SERVER_PORT;
    process.env.WEB_SERVER_PORT = "not-a-port";
    try {
      expect(checkEnv().some((p) => p.fatal && p.message.includes("WEB_SERVER_PORT"))).toBe(true);
    } finally {
      if (prev === undefined) delete process.env.WEB_SERVER_PORT;
      else process.env.WEB_SERVER_PORT = prev;
    }
  });
});

describe("agent root resolution", () => {
  it("finds pr-review-agent's own root regardless of process.cwd()", () => {
    const from = process.cwd();
    try {
      process.chdir(path.parse(from).root);
      const root = findAgentRoot();
      // The marker file is what makes this pr-review-agent's root, not a guess
      // based on the launch directory.
      expect(existsSync(path.join(root, "mcp-server", "package.json"))).toBe(true);
    } finally {
      process.chdir(from);
    }
  });
});
