# Ingestion Pipeline

Ingestion is the most failure-prone path in POAR: a single paper touches
Supabase Storage, `unpdf`, Anthropic, OpenAI, and Postgres in sequence, and
any of them can time out or rate-limit. This doc describes the pipeline as
it stands today, the explicit job states, the retry policy, and the swap-in
path to a real distributed queue.

## States

```
   pending  ─►  parsing  ─►  embedding  ─►  summarizing  ─►  ready
                  │             │              │
                  ▼             ▼              ▼
                                          (any failure)
                                                ▼
                                            failed
                                                ▲
                                                │ (final)
                                            retrying  (transient only)
                                                │
                                          (next attempt) -> parsing ...
```

Every transition is one row update in `public.papers`. The `0006_ingestion_jobs.sql`
migration:

- Replaces the old `status IN ('pending','parsing','embedding','ready','failed')`
  CHECK with the broader set including `summarizing` and `retrying`.
- Adds bookkeeping columns:
  - `ingest_attempts` — bumped by trigger every time the row enters
    `parsing` or `retrying` from a terminal state.
  - `ingest_started_at` — stamped by trigger when an attempt begins.
  - `ingest_finished_at` — stamped when the row reaches `ready` or `failed`.
  - `ingest_progress_pct` — advisory `0..100`, clamped to 100 by trigger
    when status flips to `ready`.
- Adds a partial index on non-terminal statuses so a future watchdog can
  reap stuck rows without scanning the whole table.

## Code shape

| Function | Where | What it does |
| --- | --- | --- |
| `ingestPaper(paperId, opts)` | `src/lib/ingest/index.ts` | The pipeline. Sets per-stage status + progress, retries transient errors, classifies the failure on a hard fail. |
| `enqueueIngest(paperId, opts)` | `src/lib/ingest/index.ts` | The route-facing entry point. Today it just calls `ingestPaper(...)` with `maxAttempts: 2`. Tomorrow it posts to a queue. |
| `getIngestJob(paperId)` | `src/lib/ingest/index.ts` | Reads the current job state (status + attempts + progress + timestamps). |

The route handler at `src/app/api/papers/ingest/route.ts` is intentionally
small: auth → rate-limit → schema parse → ownership check →
`enqueueIngest()`. Any future migration (Cloudflare Queues, Inngest,
Trigger.dev, pg-boss) only swaps the body of `enqueueIngest`, not the route.

## Retry policy

`ingestPaper` accepts `{ maxAttempts }` (default `1`; the route uses `2`). On
each attempt:

1. Run the pipeline.
2. On failure, classify the error via `classifyError()`.
3. If the error is **transient** (`timeout`, `rate_limit`, `internal`) and
   we still have attempts left:
   - Update `papers.status = 'retrying'` with the classified message.
   - Sleep `min(15s, 500 * 2^(attempt-1)) ms` (exponential backoff, capped).
   - Retry.
4. If the error is **non-transient** (`ingest_no_text`, `validation`,
   `auth`, `model`, `embedding`) or attempts are exhausted:
   - Update `papers.status = 'failed'` with the classified message.
   - Re-throw.

The split is deliberate: replaying a scanned-PDF ingestion will fail again
on every attempt, so we surface it immediately and the user can fix the
input. A timeout from Anthropic during summary generation, by contrast, is
worth a second swing.

## Progress reporting

Every stage writes an advisory `ingest_progress_pct`:

| Stage | % at start | UI affordance |
| --- | --- | --- |
| `parsing` | 10 | "Reading PDF…" |
| `embedding` | 40 | "Embedding chunks…" |
| `summarizing` | 90 | "Writing summary…" |
| `ready` | 100 | (terminal) |

The trigger clamps to 100 when status flips to `ready`, so there is no
"stuck at 99%" race. The library page already subscribes to the
`papers` realtime publication; the new `ingest_progress_pct` column rides
along with the same status broadcast.

## Why not a real queue today

The codebase ships on Cloudflare Pages / Workers via `@opennextjs/cloudflare`.
Cloudflare Queues, Inngest, and Trigger.dev are all good answers but each:

- adds an external dep that needs a free-tier account;
- requires deploy-time wiring (queue bindings, webhooks);
- splits "where a paper is being processed" between two systems.

For portfolio scope, the explicit pre-state (`pending`), the defined
transient/non-transient retry policy, and the `enqueueIngest()` indirection
deliver 90% of the operational benefit (visible progress, retries, no lost
rows on transient failures) without the infrastructure tax. The remaining
10% is "ingestion survives a worker isolate dying mid-attempt", which
matters at hundreds-of-papers-per-minute scale, not portfolio scale.

When that day comes, the swap is mechanical:

```ts
// src/lib/ingest/index.ts (queue-backed)
export async function enqueueIngest(paperId: string): Promise<IngestResult> {
  await env.INGEST_QUEUE.send({ paperId });
  return getIngestJob(paperId)!; // poll-able
}

// queue consumer (separate Worker)
export default {
  async queue(batch, env) {
    for (const m of batch.messages) {
      await ingestPaper(m.body.paperId, { maxAttempts: 3 });
    }
  },
};
```

## Failure modes & mitigations

| Failure | Detection | What happens |
| --- | --- | --- |
| Storage download error | `dlErr` from `supabase.storage.download` | Status → `failed`, error stored. Retry only if classified as transient. |
| Scanned PDF / no text | `pages.every(p => !p.text.trim())` | Status → `failed`, error: "no extractable text". Non-transient, no retry. |
| Anthropic 429 / 5xx | Caught by classifier as `model` | Today: surfaced as failed (non-transient). Future: classify timeout-like 5xx as transient. |
| OpenAI 429 / 5xx | Caught by classifier as `embedding` | Same as above. |
| Chunk insert collision | `insErr` from chunk insert | Status → `failed`. The unique `(paper_id, chunk_index)` constraint protects against duplicates after retry. |
| Worker isolate killed mid-attempt | (no detection today) | Row stays in non-terminal status. Future watchdog reads `papers_status_progress_idx` and resets stale rows. |
| User deletes paper mid-ingest | Foreign keys cascade | Pipeline next stage write returns "no rows updated"; harmless. |

## Operational tips

- Use the structured logs (`ingest.parse.done`, `ingest.embed.done`, etc.)
  to find which stage is dominating latency.
- The 0006 migration's partial index is the natural query for "find me
  papers stuck for >10 min": `select * from papers where status in
  ('parsing','embedding','summarizing','retrying') and updated_at < now() -
  interval '10 minutes'`.
- The `ingest_attempts` counter is monotonic per row, so `>= 3` is a strong
  hint that the input is broken (scanned PDF, broken DOI extraction, etc.).
