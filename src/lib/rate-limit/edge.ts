import {
  getLimitForScope,
  getRateLimiter,
  type RateLimitScope,
  type RateLimitResult,
} from "./index";

/**
 * Extract a stable rate-limit key for this request. Authenticated users are
 * keyed by their user id (the most accurate signal). Anonymous requests fall
 * back to a Cloudflare-friendly IP header chain.
 */
export function rateLimitKey(args: {
  req: Request;
  userId?: string | null;
  scope: RateLimitScope;
}): string {
  const id = args.userId
    ? `user:${args.userId}`
    : `ip:${ipFromRequest(args.req) ?? "unknown"}`;
  return `${id}:${args.scope}`;
}

export function ipFromRequest(req: Request): string | null {
  const h = req.headers;
  return (
    h.get("cf-connecting-ip") ??
    h.get("x-real-ip") ??
    (h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null)
  );
}

/**
 * Enforce rate limiting for a route. Returns:
 *  - `null` when the request is allowed; the caller proceeds normally.
 *  - A 429 `Response` ready to return when the limit is exceeded.
 *
 * The 429 response body and headers are friendly to both `useChat` (which
 * surfaces the body in `error.message`) and to plain `fetch` consumers.
 */
export async function enforceRateLimit(args: {
  req: Request;
  scope: RateLimitScope;
  userId?: string | null;
  /** Override the env-driven default (tests only). */
  override?: { limit: number; windowMs: number };
}): Promise<{ result: RateLimitResult; limited: Response | null }> {
  const opts = args.override ?? getLimitForScope(args.scope);
  const key = rateLimitKey(args);
  const result = await getRateLimiter().check(key, opts);

  const headers = rateLimitHeaders(result);
  if (result.allowed) {
    return { result, limited: null };
  }
  const body = JSON.stringify({
    error: "rate_limited",
    scope: args.scope,
    detail: `Rate limit exceeded for ${args.scope}: ${opts.limit} requests/min. Try again in ${result.retryAfterSec}s.`,
    retry_after_sec: result.retryAfterSec,
  });
  return {
    result,
    limited: new Response(body, {
      status: 429,
      headers: { ...headers, "content-type": "application/json" },
    }),
  };
}

export function rateLimitHeaders(r: RateLimitResult): Record<string, string> {
  return {
    "x-ratelimit-limit": String(r.limit),
    "x-ratelimit-remaining": String(r.remaining),
    "x-ratelimit-reset": String(Math.ceil(r.resetAt / 1000)),
    ...(r.allowed ? {} : { "retry-after": String(r.retryAfterSec) }),
  };
}
