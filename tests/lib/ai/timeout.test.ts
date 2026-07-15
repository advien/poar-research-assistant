import { afterEach, describe, expect, it } from "vitest";
import { aiTimeoutMs, aiTimeoutSignal } from "@/lib/ai/timeout";

afterEach(() => {
  delete process.env.AI_REQUEST_TIMEOUT_MS;
});

describe("aiTimeoutMs", () => {
  it("defaults to 30s when the env var is unset", () => {
    expect(aiTimeoutMs()).toBe(30_000);
  });

  it("honours a valid AI_REQUEST_TIMEOUT_MS override", () => {
    process.env.AI_REQUEST_TIMEOUT_MS = "5000";
    expect(aiTimeoutMs()).toBe(5000);
  });

  it.each([["abc"], ["-100"], ["0"], [""]])(
    "falls back to the default for invalid value '%s'",
    (raw) => {
      process.env.AI_REQUEST_TIMEOUT_MS = raw;
      expect(aiTimeoutMs()).toBe(30_000);
    }
  );
});

describe("aiTimeoutSignal", () => {
  it("returns a fresh, not-yet-aborted AbortSignal", () => {
    const s = aiTimeoutSignal();
    expect(s).toBeInstanceOf(AbortSignal);
    expect(s.aborted).toBe(false);
    expect(aiTimeoutSignal()).not.toBe(s);
  });
});
