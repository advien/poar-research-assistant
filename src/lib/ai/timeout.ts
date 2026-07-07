/**
 * Per-request timeout for outbound AI / embedding calls.
 *
 * Without an abort signal a hung upstream (OpenAI / Anthropic) keeps the
 * Worker invocation alive until the platform kills it — wasting the waitUntil
 * budget during background ingest and surfacing as an opaque failure. A fired
 * `AbortSignal.timeout` rejects with a message containing "timeout", which
 * `classifyError` maps to `timeout` (transient) so the pipeline retries.
 *
 * Tunable via AI_REQUEST_TIMEOUT_MS (milliseconds).
 */
const DEFAULT_AI_TIMEOUT_MS = 30_000;

export function aiTimeoutMs(): number {
  const raw = process.env.AI_REQUEST_TIMEOUT_MS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_AI_TIMEOUT_MS;
}

/** Fresh signal that aborts after the configured timeout. */
export function aiTimeoutSignal(): AbortSignal {
  return AbortSignal.timeout(aiTimeoutMs());
}
