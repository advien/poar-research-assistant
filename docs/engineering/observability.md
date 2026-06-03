# Observability & Structured Logging

Production AI applications fail in interesting ways: a model returns
non-conformant JSON; an embedding call rate-limits; the retriever returns
zero rows because RLS rejected the query. To debug those incidents you need
**structured** logs you can group by request, route, model, and error class —
not free-text `console.log` lines.

POAR ships a tiny zero-dep JSON logger
([`src/lib/observability/logger.ts`](../../src/lib/observability/logger.ts))
designed for the Cloudflare Workers / Edge / Node runtime mix the app
deploys into.

## Output shape

Every log line is one JSON object on one line, written via `console.{log,
warn, error}` so Cloudflare Logpush, Vercel Logs, and the local dev console
all ingest it cleanly:

```json
{
  "ts": "2026-05-19T12:00:00.000Z",
  "level": "info",
  "msg": "rag.retrieve.done",
  "request_id": "0e7c1b1a-...",
  "user_id": "8a82b7e3-...",
  "route": "/api/chat",
  "chat_id": "...",
  "paper_id": null,
  "retrieved_chunks": 8,
  "retrieved_chunk_ids": ["...", "..."],
  "empty": false,
  "latency_ms": 842
}
```

## Standard fields

The logger ships these fields automatically when you use
`createRequestLogger({ route, userId })`:

| Field | Source | Notes |
| --- | --- | --- |
| `ts` | `new Date().toISOString()` | Always emitted. |
| `level` | call-site | `debug` / `info` / `warn` / `error`. |
| `msg` | call-site | A stable dotted event name (`rag.retrieve.start`, `chat.generation.done`). |
| `request_id` | auto via `crypto.randomUUID()` | Override with `requestId` if you receive one upstream. |
| `route` | constructor arg | The Next App Router path of the handler. |
| `user_id` | constructor arg | Optional. Omitted for unauthenticated logs. |

Per-call fields are the responsibility of the call site. The recommended
fields per stage are:

| Stage | Fields |
| --- | --- |
| **Retrieval** | `retrieved_chunks` (count), `retrieved_chunk_ids` (top-k ids), `empty` (true if no rows), `latency_ms`, `paper_id`. |
| **Generation** | `model`, `finish_reason`, `latency_ms`, `total_latency_ms`, `token_usage: { prompt, completion, total }`, `citations_count`. |
| **Ingestion** | `paper_id`, `attempt`, `pages`, `chunks`, `vectors`, `dim`, per-stage `latency_ms`, `total_latency_ms`. |
| **Errors** | `error_type` (classified, see below), `message`. |

## Error classification

`classifyError(err)` maps any thrown value to a stable `error_type` so
dashboards can group by failure mode without pattern-matching free text.

| `error_type` | When it fires |
| --- | --- |
| `auth` | RLS rejected the read, or unauthorized response. |
| `rate_limit` | Upstream 429 or our own limiter triggered. |
| `timeout` | Upstream timeout, Workers CPU cap. |
| `ingest_no_text` | Scanned PDF / no extractable text. |
| `embedding` | OpenAI embedding error. |
| `model` | Anthropic / Claude generation error. |
| `validation` | Zod / schema rejection. |
| `internal` | Anything else `Error`-shaped. |
| `unknown` | Non-Error throw. |

The classifier is deliberately small — error groupings should be **few and
stable** so dashboard filters don't need rebuilding every release.

## How logs are wired in

| Module | Logger creation |
| --- | --- |
| `src/app/api/chat/route.ts` | `createRequestLogger({ route: '/api/chat' })`, `.child({ user_id })`, `.child({ chat_id, paper_id })`. |
| `src/app/api/papers/ingest/route.ts` | Route-level logger forwards into `ingestPaper(..., { logger })` so the pipeline shares the same `request_id`. |
| `src/lib/ingest/index.ts` | `ingest.parse.done`, `ingest.metadata.done`, `ingest.chunk.done`, `ingest.embed.done`, `ingest.summary.done`, `ingest.done`, plus `ingest.attempt_failed` / `ingest.retrying` for the retry loop. |
| `src/app/api/papers/[id]/{summary,terminology}/route.ts` | One `*.generation.done` and `*.generation.failed` event per request. |
| `src/app/api/comparisons/route.ts` | `comparison.generation.done` and `comparison.generation.failed`. |

The retriever (`src/lib/rag/retrieve.ts`) intentionally has no logger — it is
a pure function injected into routes. The route is the right place to log
retrieval results because that is where `request_id` and `user_id` already
live.

## Minimum log level

Set `LOG_LEVEL=warn` (or `error`, `info`, `debug`) in production to filter
the console firehose. Default is `info`.

## Querying logs in production

Cloudflare Logpush will deliver one JSON object per stdout line straight to
S3 / Datadog / your pipeline of choice. Useful queries to bookmark:

```sql
-- Slowest 50 chat completions in the last 24h
select ts, latency_ms, total_latency_ms, retrieved_chunks, token_usage
from logs
where msg = 'chat.generation.done'
  and ts > now() - interval '24 hours'
order by total_latency_ms desc
limit 50;

-- Empty-retrieval rate per route
select route, count(*) filter (where empty) * 1.0 / count(*) as empty_rate
from logs
where msg = 'rag.retrieve.done'
group by route;

-- Top error types in the last hour
select error_type, count(*)
from logs
where level = 'error' and ts > now() - interval '1 hour'
group by error_type
order by count desc;

-- Token usage by model per day
select date_trunc('day', ts) as day,
       model,
       sum((token_usage->>'total')::int) as tokens
from logs
where msg in ('chat.generation.done', 'summary.generation.done',
              'terminology.generation.done', 'comparison.generation.done')
group by 1, 2
order by day desc;
```

## Conventions for new code

- **One `request_id` per HTTP request.** Always go through
  `createRequestLogger`. Never `console.log` from a route handler.
- **Dotted event names.** `<feature>.<stage>.<verb>` — for example
  `rag.retrieve.done`, `ingest.chunk.done`, `chat.generation.failed`. Verbs
  are `start`, `done`, `failed`, `retrying`, `blocked`.
- **Don't log user content.** Question text is sensitive; we log identifiers
  (`chat_id`, `paper_id`) instead.
- **Always log a terminal event.** Every successful + failed branch should
  emit one event with `latency_ms` so dashboards see complete histograms.
- **No PII in `error_type`.** Use the classified label; the original message
  goes in `message`.

## RAG Trace Store

In addition to ephemeral log lines, every completed chat request writes one
persistent row to the `rag_traces` Supabase table via
[`src/lib/observability/trace.ts`](../../src/lib/observability/trace.ts).

The write is **fire-and-forget** inside `streamText`'s `onFinish` callback —
it never blocks the streaming response. Failures are caught and logged as
`trace.write.failed` warnings; they do not surface to the user.

### Why a separate table and not just logs

Log lines are ephemeral and platform-dependent (Cloudflare Logpush, Vercel
Logs). `rag_traces` is durable, queryable with plain SQL, and — crucially —
has two nullable columns (`eval_faithfulness`, `eval_answer_relevancy`) that
the weekly eval pipeline fills in asynchronously. Logs cannot be mutated
after the fact; a Postgres row can.

### Schema

| Column | Type | What it captures |
| --- | --- | --- |
| `request_id` | text | Ties the row to the structured log lines for the same request. |
| `user_id` | uuid | RLS key — users can only read their own traces. |
| `chat_id` | uuid | Which conversation this turn belongs to. |
| `paper_id` | uuid\|null | Set for per-paper chats; null for cross-library. |
| `query` | text | The user's question (stored for eval replay). |
| `model` | text | The Claude model string used for generation. |
| `retrieval_latency_ms` | integer | Time from embed-query call to RPC return. |
| `retrieval_chunk_count` | integer | Number of chunks returned by `match_chunks`. |
| `retrieval_top_score` | real | Highest cosine similarity in the result set (0–1). |
| `retrieval_empty` | boolean | True when the RPC returned zero rows. |
| `generation_latency_ms` | integer | Time from `streamText` start to `onFinish`. |
| `total_latency_ms` | integer | End-to-end wall time for the full request. |
| `input_tokens` | integer | Prompt tokens from the Anthropic response. |
| `output_tokens` | integer | Completion tokens from the Anthropic response. |
| `finish_reason` | text | `stop` / `length` / `error` from the model. |
| `citations_count` | integer | Number of citations returned to the client. |
| `eval_faithfulness` | real\|null | DeepEval faithfulness score (0–1), written by `evals/run.py`. |
| `eval_answer_relevancy` | real\|null | DeepEval answer relevancy score (0–1), written by `evals/run.py`. |
| `answer_text` | text | Full assistant response, stored for eval replay. |

### RLS

Users can `SELECT` their own rows (`auth.uid() = user_id`). The eval pipeline
uses the service-role key to `UPDATE` eval score columns — this bypasses RLS
and is intentional (the eval runner is a trusted offline job, not a user
request).

### Sample SQL queries

```sql
-- Average retrieval latency and top similarity score by week
select date_trunc('week', created_at) as week,
       avg(retrieval_latency_ms)      as avg_retrieval_ms,
       avg(retrieval_top_score)       as avg_top_score,
       sum(case when retrieval_empty then 1 else 0 end) * 1.0 / count(*) as empty_rate
from rag_traces
group by 1 order by 1 desc;

-- Rows with low faithfulness that need attention
select id, query, eval_faithfulness, eval_answer_relevancy, created_at
from rag_traces
where eval_faithfulness < 0.7
order by created_at desc
limit 20;

-- Token spend per day
select date_trunc('day', created_at) as day,
       sum(input_tokens)             as prompt_tokens,
       sum(output_tokens)            as completion_tokens
from rag_traces
group by 1 order by 1 desc;

-- Unscored rows (not yet evaluated by run.py)
select count(*) from rag_traces where eval_faithfulness is null;
```

---

## Tradeoffs

- **In-process, no remote sink.** Workers cannot run background flush loops
  without breaking the streaming response, so we rely on the platform's
  log-forwarding (Logpush / Vercel Logs / Datadog). This means there is **no
  retry on log delivery** — a Logpush outage drops lines. Acceptable for
  observability data; not acceptable for billing.
- **No sampling.** Logs are emitted on every request. At portfolio scale this
  is free; at million-RPM it would need a `sampleRate` arg on
  `createRequestLogger`.
- **JSON-string console writes** are slightly more expensive than a typed
  binary protocol, but keep the cold-start surface zero. Logger init is one
  closure allocation.
