/**
 * Pragmatic structured JSON logger for an Edge / Workers / Node mixed runtime.
 *
 * Why this and not pino / winston?
 *  - Workers / Edge: no Node streams, no pino transport. Plain `console.log`
 *    of a stringified JSON object is what the Cloudflare logpush + Vercel
 *    Logs ingestion already index.
 *  - We want a single shape across `ingest -> retrieval -> generation` so
 *    grouping by `request_id` works without a wrapper layer.
 *  - Zero deps. Zero runtime allocations beyond the JSON.stringify of the log
 *    object itself.
 *
 * Output shape (one JSON object per line):
 *   {
 *     "ts": "2026-05-19T12:00:00.000Z",
 *     "level": "info",
 *     "msg": "rag.retrieve.done",
 *     "request_id": "...",
 *     "user_id": "...",
 *     "route": "/api/chat",
 *     "model": "claude-sonnet-4-5",
 *     "latency_ms": 842,
 *     "retrieved_chunks": 8,
 *     "retrieved_chunk_ids": ["..."],
 *     ...arbitrary user-supplied fields
 *   }
 *
 * Usage:
 *   const log = createRequestLogger({ route: '/api/chat', userId: u.id });
 *   log.info('rag.retrieve.start');
 *   ...
 *   log.info('rag.retrieve.done', { retrieved_chunks: 8, latency_ms: t() });
 *   log.error('rag.retrieve.failed', { error_type: 'rpc', message });
 */

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_RANK: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

function minLevel(): number {
  const raw = (process.env.LOG_LEVEL ?? "info").toLowerCase();
  if (raw in LEVEL_RANK) return LEVEL_RANK[raw as LogLevel];
  return LEVEL_RANK.info;
}

export type LogContext = Record<string, unknown>;

export type Logger = {
  debug(msg: string, fields?: LogContext): void;
  info(msg: string, fields?: LogContext): void;
  warn(msg: string, fields?: LogContext): void;
  error(msg: string, fields?: LogContext): void;
  /** Returns a child logger with extra default fields merged in. */
  child(extra: LogContext): Logger;
  /** Default fields attached to every log line from this instance. */
  context: LogContext;
};

/**
 * `crypto.randomUUID()` is available in Edge, Node 19+, and modern browsers.
 * Workers and Vercel Edge both expose the global `crypto`.
 */
export function newRequestId(): string {
  if (typeof globalThis.crypto?.randomUUID === "function") {
    return globalThis.crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2, 12);
}

/**
 * `Date.now()` based timer. Tiny helper so call sites don't have to track
 * start times manually: `const t = startTimer(); /* work *\/; t.ms()`.
 */
export function startTimer(): { ms: () => number } {
  const start = Date.now();
  return { ms: () => Date.now() - start };
}

function emit(level: LogLevel, msg: string, fields: LogContext): void {
  if (LEVEL_RANK[level] < minLevel()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    msg,
    ...fields,
  };
  // Cloudflare's logpush, Vercel Logs, and Datadog-style ingestion all parse
  // these as JSON when a single console call writes a single object. We use
  // the matching console method so dev consoles colour-code by severity.
  const out = JSON.stringify(line);
  switch (level) {
    case "debug":
      console.debug(out);
      break;
    case "info":
      console.log(out);
      break;
    case "warn":
      console.warn(out);
      break;
    case "error":
      console.error(out);
      break;
  }
}

/**
 * Build a logger with the given default context. Most call sites should use
 * the more specific `createRequestLogger` factory below, but pure background
 * jobs can use this one directly.
 */
export function createLogger(context: LogContext = {}): Logger {
  const make = (ctx: LogContext): Logger => ({
    context: ctx,
    debug: (msg, fields) => emit("debug", msg, { ...ctx, ...fields }),
    info: (msg, fields) => emit("info", msg, { ...ctx, ...fields }),
    warn: (msg, fields) => emit("warn", msg, { ...ctx, ...fields }),
    error: (msg, fields) => emit("error", msg, { ...ctx, ...fields }),
    child: (extra) => make({ ...ctx, ...extra }),
  });
  return make(context);
}

/**
 * Build a logger pre-populated with `request_id`, `route`, optional `user_id`,
 * and any other call-site fields. This is the canonical way to create a
 * logger inside a route handler.
 */
export function createRequestLogger(args: {
  route: string;
  userId?: string | null;
  /** Override the auto-generated request id (e.g. when one is supplied via header). */
  requestId?: string;
  /** Extra default fields. */
  extra?: LogContext;
}): Logger {
  return createLogger({
    request_id: args.requestId ?? newRequestId(),
    route: args.route,
    ...(args.userId ? { user_id: args.userId } : {}),
    ...(args.extra ?? {}),
  });
}

/**
 * Categorise an unknown error into a stable `error_type` string so dashboards
 * can group by failure mode without having to pattern-match on free-text.
 */
export function classifyError(err: unknown): { error_type: string; message: string } {
  if (err instanceof Error) {
    // OpenAI / Anthropic SDKs surface transport failures as a generic
    // `APIConnectionError` ("Connection error.") and stash the real reason
    // (ECONNRESET, fetch failed, ENOTFOUND, ...) on `err.cause`. Fold the
    // cause into the message so dashboards and `papers.error` show why the
    // outbound request failed instead of an opaque "Connection error.".
    const cause = (err as { cause?: unknown }).cause;
    const causeMsg =
      cause instanceof Error ? cause.message : cause != null ? String(cause) : "";
    const msg = causeMsg ? `${err.message} (${causeMsg})` : err.message ?? String(err);
    if (/permission denied|unauthorized|RLS/i.test(msg)) {
      return { error_type: "auth", message: msg };
    }
    if (/rate.?limit|429/i.test(msg)) return { error_type: "rate_limit", message: msg };
    // `AbortSignal.timeout` rejects with a TimeoutError / "aborted due to
    // timeout" style message depending on runtime — treat all as timeout.
    if (/timeout|timed out|aborted|AbortError|TimeoutError/i.test(msg)) {
      return { error_type: "timeout", message: msg };
    }
    // Transport-layer failures: no HTTP status came back. Classified distinctly
    // from `internal` so they aren't retried blind (see isTransient in ingest).
    if (/connection error|fetch failed|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket hang up/i.test(msg)) {
      return { error_type: "network", message: msg };
    }
    if (/no chunks|no extractable/i.test(msg)) return { error_type: "ingest_no_text", message: msg };
    if (/embedding|openai/i.test(msg)) return { error_type: "embedding", message: msg };
    if (/anthropic|claude/i.test(msg)) return { error_type: "model", message: msg };
    if (/parse|invalid/i.test(msg)) return { error_type: "validation", message: msg };
    return { error_type: "internal", message: msg };
  }
  return { error_type: "unknown", message: String(err) };
}
