import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  classifyError,
  createLogger,
  createRequestLogger,
  newRequestId,
  startTimer,
} from "@/lib/observability/logger";

const originalConsole = {
  log: console.log,
  debug: console.debug,
  warn: console.warn,
  error: console.error,
};

let captured: Array<{ method: string; payload: Record<string, unknown> }> = [];

beforeEach(() => {
  captured = [];
  for (const m of ["log", "debug", "warn", "error"] as const) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (console as any)[m] = (line: string) => {
      try {
        captured.push({ method: m, payload: JSON.parse(line) });
      } catch {
        captured.push({ method: m, payload: { raw: line } });
      }
    };
  }
});

afterEach(() => {
  Object.assign(console, originalConsole);
  delete process.env.LOG_LEVEL;
  vi.restoreAllMocks();
});

describe("createLogger", () => {
  it("emits a single JSON line per call with timestamp and level", () => {
    const log = createLogger({ route: "/api/chat" });
    log.info("rag.retrieve.start");
    expect(captured).toHaveLength(1);
    expect(captured[0].method).toBe("log");
    expect(captured[0].payload).toMatchObject({
      level: "info",
      msg: "rag.retrieve.start",
      route: "/api/chat",
    });
    expect(typeof captured[0].payload.ts).toBe("string");
  });

  it("merges per-call fields with the logger's default context", () => {
    const log = createLogger({ route: "/api/chat", request_id: "rid" });
    log.warn("rag.retrieve.empty", { query: "x" });
    expect(captured[0].payload).toMatchObject({
      level: "warn",
      msg: "rag.retrieve.empty",
      route: "/api/chat",
      request_id: "rid",
      query: "x",
    });
  });

  it("respects LOG_LEVEL=warn (info / debug suppressed)", () => {
    process.env.LOG_LEVEL = "warn";
    const log = createLogger({});
    log.debug("d");
    log.info("i");
    log.warn("w");
    log.error("e");
    expect(captured.map((c) => c.payload.msg)).toEqual(["w", "e"]);
  });

  it("child() returns a logger with merged context", () => {
    const root = createLogger({ route: "/api/chat" });
    const child = root.child({ user_id: "u1" });
    child.info("hi");
    expect(captured[0].payload).toMatchObject({ route: "/api/chat", user_id: "u1" });
  });
});

describe("createRequestLogger", () => {
  it("auto-generates a request_id and includes route", () => {
    const log = createRequestLogger({ route: "/api/chat", userId: "u1" });
    log.info("hello");
    expect(captured[0].payload.route).toBe("/api/chat");
    expect(captured[0].payload.user_id).toBe("u1");
    expect(typeof captured[0].payload.request_id).toBe("string");
    expect((captured[0].payload.request_id as string).length).toBeGreaterThan(8);
  });

  it("honours an explicit requestId override", () => {
    const log = createRequestLogger({ route: "/api/chat", requestId: "fixed-rid" });
    log.info("hello");
    expect(captured[0].payload.request_id).toBe("fixed-rid");
  });
});

describe("classifyError", () => {
  it.each([
    ["timeout", "Request timed out"],
    ["rate_limit", "429 rate-limited"],
    ["auth", "permission denied"],
    ["ingest_no_text", "no extractable text"],
    ["embedding", "openai error"],
    ["model", "claude generation failed"],
    ["validation", "invalid request"],
    ["internal", "something else broke"],
  ])("classifies '%s' messages", (tag, msg) => {
    expect(classifyError(new Error(msg)).error_type).toBe(tag);
  });

  it("classifies non-Error throws as 'unknown'", () => {
    expect(classifyError("oops").error_type).toBe("unknown");
  });
});

describe("newRequestId / startTimer", () => {
  it("newRequestId is reasonably unique", () => {
    const a = newRequestId();
    const b = newRequestId();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(8);
  });

  it("startTimer measures elapsed ms", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-19T12:00:00.000Z"));
    const t = startTimer();
    vi.setSystemTime(new Date("2026-05-19T12:00:00.250Z"));
    expect(t.ms()).toBe(250);
    vi.useRealTimers();
  });
});
