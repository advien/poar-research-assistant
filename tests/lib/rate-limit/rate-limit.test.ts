import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __setRateLimiterForTests,
  getLimitForScope,
  getRateLimiter,
} from "@/lib/rate-limit";
import { enforceRateLimit, ipFromRequest, rateLimitKey } from "@/lib/rate-limit/edge";

beforeEach(() => {
  __setRateLimiterForTests(null);
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-05-19T12:00:00Z"));
});
afterEach(() => {
  vi.useRealTimers();
  __setRateLimiterForTests(null);
  for (const k of [
    "RATE_LIMIT_CHAT_PER_MIN",
    "RATE_LIMIT_UPLOAD_PER_MIN",
    "RATE_LIMIT_SUMMARY_PER_MIN",
    "RATE_LIMIT_TERMINOLOGY_PER_MIN",
    "RATE_LIMIT_COMPARISON_PER_MIN",
  ]) {
    delete process.env[k];
  }
});

describe("MemoryRateLimiter (in-memory fixed window)", () => {
  it("allows requests up to the limit, then 429s the next one", async () => {
    const limiter = getRateLimiter();
    const opts = { limit: 3, windowMs: 60_000 };
    const r1 = await limiter.check("user:a:chat", opts);
    const r2 = await limiter.check("user:a:chat", opts);
    const r3 = await limiter.check("user:a:chat", opts);
    const r4 = await limiter.check("user:a:chat", opts);
    expect([r1, r2, r3].every((r) => r.allowed)).toBe(true);
    expect(r4.allowed).toBe(false);
    expect(r4.remaining).toBe(0);
    expect(r4.retryAfterSec).toBeGreaterThan(0);
  });

  it("isolates buckets across keys", async () => {
    const limiter = getRateLimiter();
    const opts = { limit: 1, windowMs: 60_000 };
    expect((await limiter.check("user:a:chat", opts)).allowed).toBe(true);
    expect((await limiter.check("user:b:chat", opts)).allowed).toBe(true);
    expect((await limiter.check("user:a:chat", opts)).allowed).toBe(false);
  });

  it("resets the bucket after the window elapses", async () => {
    const limiter = getRateLimiter();
    const opts = { limit: 2, windowMs: 60_000 };
    await limiter.check("user:a:chat", opts);
    await limiter.check("user:a:chat", opts);
    expect((await limiter.check("user:a:chat", opts)).allowed).toBe(false);
    vi.setSystemTime(new Date("2026-05-19T12:01:01Z")); // 61s later
    const after = await limiter.check("user:a:chat", opts);
    expect(after.allowed).toBe(true);
    expect(after.remaining).toBe(1);
  });
});

describe("getLimitForScope", () => {
  it("returns the documented defaults", () => {
    expect(getLimitForScope("chat").limit).toBe(10);
    expect(getLimitForScope("upload").limit).toBe(3);
    expect(getLimitForScope("comparison").limit).toBe(3);
    expect(getLimitForScope("summary").limit).toBe(5);
    expect(getLimitForScope("terminology").limit).toBe(5);
  });

  it("respects env overrides", () => {
    process.env.RATE_LIMIT_CHAT_PER_MIN = "42";
    expect(getLimitForScope("chat").limit).toBe(42);
  });

  it("ignores invalid env values and falls back to default", () => {
    process.env.RATE_LIMIT_CHAT_PER_MIN = "abc";
    expect(getLimitForScope("chat").limit).toBe(10);
    process.env.RATE_LIMIT_CHAT_PER_MIN = "0";
    expect(getLimitForScope("chat").limit).toBe(10);
    process.env.RATE_LIMIT_CHAT_PER_MIN = "-5";
    expect(getLimitForScope("chat").limit).toBe(10);
  });
});

describe("ipFromRequest", () => {
  it("prefers cf-connecting-ip", () => {
    const req = new Request("https://x.test", {
      headers: { "cf-connecting-ip": "1.2.3.4", "x-forwarded-for": "9.9.9.9" },
    });
    expect(ipFromRequest(req)).toBe("1.2.3.4");
  });

  it("falls back to first x-forwarded-for entry", () => {
    const req = new Request("https://x.test", {
      headers: { "x-forwarded-for": "5.6.7.8, 9.9.9.9" },
    });
    expect(ipFromRequest(req)).toBe("5.6.7.8");
  });

  it("returns null when no header is present", () => {
    expect(ipFromRequest(new Request("https://x.test"))).toBeNull();
  });
});

describe("rateLimitKey", () => {
  it("prefers user id when authenticated", () => {
    const req = new Request("https://x.test", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    expect(rateLimitKey({ req, userId: "u1", scope: "chat" })).toBe("user:u1:chat");
  });
  it("falls back to ip", () => {
    const req = new Request("https://x.test", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    expect(rateLimitKey({ req, userId: null, scope: "chat" })).toBe("ip:1.2.3.4:chat");
  });
});

describe("enforceRateLimit (route helper)", () => {
  it("returns null Response when allowed", async () => {
    const req = new Request("https://x.test", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const { limited } = await enforceRateLimit({
      req,
      scope: "chat",
      userId: "u1",
      override: { limit: 5, windowMs: 60_000 },
    });
    expect(limited).toBeNull();
  });

  it("returns a 429 with Retry-After + JSON body when blocked", async () => {
    const req = new Request("https://x.test", {
      headers: { "cf-connecting-ip": "1.2.3.4" },
    });
    const opts = { limit: 1, windowMs: 60_000 };
    await enforceRateLimit({ req, scope: "chat", userId: "u1", override: opts });
    const { limited } = await enforceRateLimit({
      req,
      scope: "chat",
      userId: "u1",
      override: opts,
    });
    expect(limited).not.toBeNull();
    expect(limited!.status).toBe(429);
    expect(limited!.headers.get("retry-after")).toBeTruthy();
    expect(limited!.headers.get("x-ratelimit-limit")).toBe("1");
    expect(limited!.headers.get("x-ratelimit-remaining")).toBe("0");

    const body = await limited!.json();
    expect(body.error).toBe("rate_limited");
    expect(body.scope).toBe("chat");
    expect(body.retry_after_sec).toBeGreaterThan(0);
    expect(body.detail).toMatch(/chat/);
  });
});
