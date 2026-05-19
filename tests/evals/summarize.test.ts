/**
 * The eval runner is a CLI script (evals/run.ts), not a library, so it
 * doesn't have a Vitest entry by default. We do unit-test the pure helpers
 * by inlining them: the same logic is re-implemented in `src/lib/evals/metrics.ts`
 * to keep the runner zero-dep, but the contract is exercised here.
 *
 * If the runner's helpers and these helpers ever diverge, the runner is the
 * source of truth — update `src/lib/evals/metrics.ts` to match.
 */

import { describe, expect, it } from "vitest";
import {
  answerMatches,
  detectRefusal,
  percentile,
  retrievalHit,
} from "@/lib/evals/metrics";

describe("retrievalHit", () => {
  it("returns true when any keyword appears in any snippet (case-insensitive)", () => {
    const cites = [{ snippet: "We used the Ninapro DB-2 dataset." }];
    expect(retrievalHit(cites, ["ninapro", "imu"])).toBe(true);
  });
  it("returns false when no keyword matches", () => {
    const cites = [{ snippet: "Foo bar baz" }];
    expect(retrievalHit(cites, ["ninapro", "imu"])).toBe(false);
  });
  it("returns true when no keywords are required and there are citations", () => {
    expect(retrievalHit([{ snippet: "x" }], [])).toBe(true);
  });
  it("returns false when no keywords required and no citations", () => {
    expect(retrievalHit([], [])).toBe(false);
  });
});

describe("answerMatches", () => {
  it("matches case-insensitively against any needle", () => {
    expect(answerMatches("The dataset was Ninapro DB-2.", ["ninapro"])).toBe(true);
    expect(answerMatches("The dataset was Ninapro DB-2.", ["nope"])).toBe(false);
  });
  it("returns true when no needles required", () => {
    expect(answerMatches("anything", undefined)).toBe(true);
    expect(answerMatches("anything", [])).toBe(true);
  });
});

describe("detectRefusal", () => {
  it("flags 'no context' phrasing", () => {
    expect(detectRefusal("I don't have context for that.", 0)).toBe(true);
    expect(detectRefusal("There is no relevant context in your library.", 0)).toBe(true);
  });
  it("flags short uncited answers as refusals (defensive)", () => {
    expect(detectRefusal("I'm not sure.", 0)).toBe(true);
  });
  it("does NOT flag a long, well-cited grounded answer", () => {
    const long = "The dataset was Ninapro DB-2 [1] consisting of 40 subjects. ".repeat(20);
    expect(detectRefusal(long, 5)).toBe(false);
  });
  it("flags an empty answer as a refusal", () => {
    expect(detectRefusal("", 0)).toBe(true);
  });
});

describe("percentile", () => {
  it("returns 0 for empty input", () => {
    expect(percentile([], 50)).toBe(0);
  });
  it("computes p50 / p95", () => {
    const xs = [10, 20, 30, 40, 50, 60, 70, 80, 90, 100];
    expect(percentile(xs, 50)).toBeGreaterThanOrEqual(50);
    expect(percentile(xs, 95)).toBeGreaterThanOrEqual(90);
  });
});
