import { describe, expect, it } from "vitest";
import { REVIEW_COMMENT_MARKER, formatError, retryDelayMs } from "../src/github/githubClient";

/** Shape an Octokit RequestError closely enough for the retry policy. */
function httpError(status: number, headers: Record<string, string> = {}): unknown {
  return Object.assign(new Error(`HTTP ${status}`), { status, response: { headers } });
}

describe("retryDelayMs", () => {
  it("retries a read on a transient server error", () => {
    const delay = retryDelayMs(httpError(502), 0, "GET");
    expect(delay).not.toBeNull();
    expect(delay!).toBeGreaterThan(0);
  });

  it("does not retry a read on a client error", () => {
    expect(retryDelayMs(httpError(404), 0, "GET")).toBeNull();
    expect(retryDelayMs(httpError(422), 0, "GET")).toBeNull();
  });

  it("never retries a write on a 500 — a flaky POST must not double-post a comment", () => {
    expect(retryDelayMs(httpError(500), 0, "POST")).toBeNull();
    expect(retryDelayMs(httpError(502), 0, "PATCH")).toBeNull();
  });

  it("does retry a write that was rejected before it executed", () => {
    expect(retryDelayMs(httpError(429), 0, "POST")).not.toBeNull();
    expect(retryDelayMs(httpError(403, { "x-ratelimit-remaining": "0" }), 0, "POST")).not.toBeNull();
  });

  it("leaves an ordinary 403 alone — that is a permissions problem, not a rate limit", () => {
    expect(retryDelayMs(httpError(403), 0, "GET")).toBeNull();
  });

  it("honours retry-after ahead of its own backoff", () => {
    expect(retryDelayMs(httpError(429, { "retry-after": "7" }), 0, "POST")).toBe(7000);
  });

  it("waits until x-ratelimit-reset when the server gives one", () => {
    const reset = Math.floor((Date.now() + 30_000) / 1000);
    const delay = retryDelayMs(httpError(429, { "x-ratelimit-reset": String(reset) }), 0, "GET");

    expect(delay).toBeGreaterThan(25_000);
    expect(delay).toBeLessThanOrEqual(60_000);
  });

  it("caps any wait at one minute", () => {
    expect(retryDelayMs(httpError(429, { "retry-after": "86400" }), 0, "GET")).toBe(60_000);
  });

  it("backs off further on each attempt", () => {
    const first = retryDelayMs(httpError(503), 0, "GET")!;
    const third = retryDelayMs(httpError(503), 2, "GET")!;
    expect(third).toBeGreaterThan(first);
  });

  it("gives up after the attempt budget", () => {
    expect(retryDelayMs(httpError(503), 3, "GET")).toBeNull();
  });

  it("does not retry a network error with no status", () => {
    expect(retryDelayMs(new Error("socket hang up"), 0, "GET")).toBeNull();
  });
});

describe("REVIEW_COMMENT_MARKER", () => {
  it("is an HTML comment, so GitHub renders nothing", () => {
    expect(REVIEW_COMMENT_MARKER.startsWith("<!--")).toBe(true);
    expect(REVIEW_COMMENT_MARKER.endsWith("-->")).toBe(true);
  });
});

describe("formatError", () => {
  it("uses the message of an Error", () => {
    expect(formatError(new Error("boom"))).toBe("boom");
  });

  it("stringifies anything else", () => {
    expect(formatError("plain")).toBe("plain");
    expect(formatError(404)).toBe("404");
  });
});
