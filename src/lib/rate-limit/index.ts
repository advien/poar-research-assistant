/**
 * Pragmatic, in-memory, per-isolate fixed-window rate limiter.
 *
 * Why this shape and not Upstash / Durable Objects / KV?
 *  - Cloudflare Workers + Next App Router run as short-lived isolates. A real
 *    distributed limiter needs an external store. We deliberately keep the
 *    interface narrow so swapping `MemoryRateLimiter` for an Upstash or KV
 *    implementation is a one-line change in `getRateLimiter()`.
 *  - In-memory is good enough as a soft barrier against abuse / runaway loops:
 *    each isolate caps a single attacker by orders of magnitude vs the same
 *    attacker hitting our origin uncapped. The user-facing 429 + Retry-After
 *    header still works correctly per-isolate.
 *  - Authenticated users are keyed by `user:<uuid>` (most accurate). Anonymous
 *    requests fall back to IP. The route helper `enforceRateLimit` handles the
 *    extraction.
 *
 * Limits are configurable via env vars (see `getDefaultLimits`). Each scope
 * (chat / upload / summary / terminology / comparison) has its own bucket so
 * a slow comparison generation does not eat the chat budget.
 */

export type RateLimitResult = {
  allowed: boolean;
  /** Remaining requests in the current window after this call is counted. */
  remaining: number;
  /** Unix-ms timestamp at which the current window resets. */
  resetAt: number;
  /** Seconds until the window resets. Suitable for a `Retry-After` header. */
  retryAfterSec: number;
  /** The configured `limit` for the bucket (echoed for observability headers). */
  limit: number;
};

export type RateLimitOptions = {
  /** Max requests allowed in the window (>= 1). */
  limit: number;
  /** Window size in milliseconds. */
  windowMs: number;
};

export interface RateLimiter {
  check(key: string, opts: RateLimitOptions): Promise<RateLimitResult>;
}

// =============================================================================
// In-memory implementation (fixed window per isolate).
// =============================================================================

type Bucket = { count: number; resetAt: number };

class MemoryRateLimiter implements RateLimiter {
  private store = new Map<string, Bucket>();
  private lastSweep = 0;

  async check(key: string, opts: RateLimitOptions): Promise<RateLimitResult> {
    const now = Date.now();
    this.maybeSweep(now);

    const existing = this.store.get(key);
    let bucket: Bucket;
    if (!existing || existing.resetAt <= now) {
      bucket = { count: 0, resetAt: now + opts.windowMs };
      this.store.set(key, bucket);
    } else {
      bucket = existing;
    }

    bucket.count += 1;
    const remaining = Math.max(0, opts.limit - bucket.count);
    const allowed = bucket.count <= opts.limit;
    const retryAfterSec = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));

    return {
      allowed,
      remaining,
      resetAt: bucket.resetAt,
      retryAfterSec,
      limit: opts.limit,
    };
  }

  /**
   * Periodic O(n) sweep to evict expired buckets. Cheap because each isolate
   * touches at most a few hundred unique keys per minute in practice.
   */
  private maybeSweep(now: number): void {
    if (now - this.lastSweep < 60_000) return;
    this.lastSweep = now;
    for (const [k, b] of this.store) {
      if (b.resetAt <= now) this.store.delete(k);
    }
  }
}

// =============================================================================
// Singleton accessor + scope/limit defaults
// =============================================================================

let _limiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!_limiter) _limiter = new MemoryRateLimiter();
  return _limiter;
}

/**
 * Override the singleton (tests only). Pass `null` to reset.
 */
export function __setRateLimiterForTests(impl: RateLimiter | null): void {
  _limiter = impl;
}

export type RateLimitScope =
  | "chat"
  | "upload"
  | "ingest"
  | "summary"
  | "terminology"
  | "comparison"
  | "search";

const SCOPE_ENV: Record<RateLimitScope, { env: string; default: number }> = {
  chat: { env: "RATE_LIMIT_CHAT_PER_MIN", default: 10 },
  upload: { env: "RATE_LIMIT_UPLOAD_PER_MIN", default: 3 },
  ingest: { env: "RATE_LIMIT_INGEST_PER_MIN", default: 3 },
  summary: { env: "RATE_LIMIT_SUMMARY_PER_MIN", default: 5 },
  terminology: { env: "RATE_LIMIT_TERMINOLOGY_PER_MIN", default: 5 },
  comparison: { env: "RATE_LIMIT_COMPARISON_PER_MIN", default: 3 },
  search: { env: "RATE_LIMIT_SEARCH_PER_MIN", default: 30 },
};

export function getLimitForScope(scope: RateLimitScope): RateLimitOptions {
  const cfg = SCOPE_ENV[scope];
  const raw = process.env[cfg.env];
  const parsed = raw ? Number.parseInt(raw, 10) : NaN;
  const limit = Number.isFinite(parsed) && parsed > 0 ? parsed : cfg.default;
  return { limit, windowMs: 60_000 };
}
