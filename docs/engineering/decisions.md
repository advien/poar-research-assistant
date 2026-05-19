# Architecture Decision Records

Lightweight ADRs for every meaningful design decision in POAR Research
Assistant. Format per record: **Context** -> **Options considered** ->
**Decision** -> **Consequences** (positive and negative).

---

## ADR-001: Next.js 15 App Router as the only deployable

### Context
Need a single deployable surface for SSR pages, API routes, server components,
and client components. Backend is light (CRUD + LLM proxying + ingestion);
no need for a separate API server.

### Options
1. Next.js App Router (RSC + route handlers).
2. Vite + React + a Hono backend.
3. Remix.
4. Astro + islands + serverless functions.

### Decision
Next.js 15 App Router.

### Consequences
- Single repo, single deployable, RSC reduces client JS.
- Suspense and error boundaries map cleanly to per-route segment files.
- App Router is opinionated; some patterns (file-based co-location of error
  / loading / route handlers) require discipline.
- Locked into Next-flavoured server caching semantics.

---

## ADR-002: Supabase as one-stop backend

### Context
Need: auth, Postgres, vector search, file storage, realtime. Single user
initially, possibly multi-user later. Want minimum operational overhead.

### Options
1. Supabase (Postgres + pgvector + Auth + Storage + Realtime).
2. Neon (Postgres + pgvector) + Clerk (auth) + S3 (storage) + custom WS.
3. Self-hosted Postgres + Hasura + Cognito + S3.
4. Firebase + Pinecone.

### Decision
Supabase.

### Consequences
- One vendor relationship, one set of credentials, one client library, one
  RLS model that covers DB rows **and** Storage objects.
- Realtime postgres_changes for free.
- Anon-key access is safe because RLS enforces per-session isolation.
- Locked into Supabase's pricing curve and feature roadmap.
- pgvector recall at very large scale (>5M vectors per user) is a future
  migration candidate to a dedicated vector store.

---

## ADR-003: pgvector over a dedicated vector store

### Context
RAG retrieval over user-private chunks. Need approximate-NN cosine search
with per-user filtering.

### Options
1. pgvector (in Supabase Postgres).
2. Pinecone.
3. Qdrant Cloud.
4. Weaviate.

### Decision
pgvector with HNSW.

### Consequences
- Retrieval RPCs filter `where user_id = auth.uid()` in the same query as
  ANN; no two-phase fetch.
- One database to back up, one query language.
- Unified RLS across embeddings, metadata, and conversations.
- HNSW with `m=16, ef_construction=64` is fast at portfolio scale; will need
  reindex / parameter tuning in the millions.
- Migration path to a dedicated store remains open via a sync job.

---

## ADR-004: Reciprocal Rank Fusion for hybrid search

### Context
Pure vector search misses literal hits (DOIs, drug names, exact device
names). Pure FTS misses paraphrases.

### Options
1. Pure vector ANN (cosine).
2. Pure FTS (`tsvector` + `ts_rank`).
3. Linear weighted combination (`alpha * vec + (1-alpha) * fts`).
4. RRF with `score = sum(1 / (rrf_k + rank))`.
5. A separate reranker model (Cohere Rerank, BGE reranker).

### Decision
RRF with `rrf_k = 60` for the search field. Pure vector for chat retrieval.

### Consequences
- No magic alpha to tune.
- Order-agnostic across the two source rankings - one ranker dominating does
  not crush the other.
- Hybrid is one extra Postgres query on top of vector search; latency budget
  unchanged for chat which sticks with pure vector.
- Future improvement: add a reranker stage for the top-N hybrid results.

---

## ADR-005: Hand-written Database types vs `supabase gen types`

### Context
Need typed access to DB rows, RPC argument / return shapes, and JSONB
payload structure.

### Options
1. `supabase gen types typescript` (CLI generates from a linked project).
2. Hand-write a `Database` type covering only the surface we use.
3. Drizzle / Kysely with TS-derived schemas.

### Decision
Hand-written, with a `db:types` script ready to switch when the project links
to a hosted Supabase instance permanently.

### Consequences
- Faster iteration during prototyping; no need to keep a hosted project on
  the dev path.
- We can encode JSONB payload types (e.g. `payload: StructuredSummaryT`) that
  the generator does not produce.
- Risk of drift between SQL and TS types - mitigated by SQL being the source
  of truth and types being derived from it.

---

## ADR-006: Anthropic + OpenAI hybrid (chat vs embeddings)

### Context
Need a strong reasoning model for chat / structured outputs, and a
cost-effective high-quality embedding model.

### Options
1. Anthropic only (Claude + Voyage embeddings via Anthropic).
2. OpenAI only (GPT-4o + `text-embedding-3-small`).
3. Mixed: Claude for chat, OpenAI for embeddings.
4. OpenRouter as a swap layer.

### Decision
Mixed: Anthropic Claude Sonnet for chat / structured / titles, OpenAI
`text-embedding-3-small` for embeddings.

### Consequences
- Best-in-class reasoning + best-in-class cheap embeddings.
- Two API keys to manage instead of one.
- Embedding model swap is a column-cast away if a better cheap option emerges.
- Direct Anthropic API call via the AI SDK keeps the chat path well-typed.

---

## ADR-007: Vercel AI SDK for streaming + structured outputs

### Context
Need: streaming chat with structured side-channel data (citations, titles),
plus `generateObject` with Zod for structured outputs.

### Options
1. Vercel AI SDK (`ai` + `@ai-sdk/anthropic`).
2. Direct `@anthropic-ai/sdk` calls + custom SSE streaming.
3. LangChain.js.

### Decision
Vercel AI SDK.

### Consequences
- `useChat` + `createDataStreamResponse` give us streaming + interleaved
  data annotations with one stable abstraction.
- `generateObject` with Zod gives schema-enforced structured outputs across
  Anthropic and OpenAI uniformly.
- Locked into one specific data-stream protocol; client and server have to
  agree on it.
- LangChain rejected as too heavyweight for this scope.

---

## ADR-008: Inline ingestion vs background queue

### Context
Ingestion involves PDF parse + Claude metadata + chunking + 1 to 30
embedding batches + Claude summary. Wall-clock: 15-90 seconds per paper.

### Options
1. Inline in the `POST /api/papers/ingest` route handler with `maxDuration = 300`.
2. A background queue (Inngest, Trigger.dev, Cloudflare Queues).
3. A pg_cron + jobs table polled by a worker.

### Decision
Inline for the MVP / portfolio scope. Document the queue migration in the
roadmap.

### Consequences
- Zero infrastructure beyond Next + Supabase.
- Cloudflare Workers Free CPU cap (30 s) is a real risk - documented in the
  deployment doc as a constraint.
- One paper at a time per user is a soft limit (each request blocks).
- Queue migration is straightforward later: swap the route's `await
  ingestPaper()` for `enqueue(ingestPaper, paperId)` and have the worker
  run the same orchestrator.

---

## ADR-009: Versioned analyses (vs single-row updates)

### Context
Users want to regenerate summaries / terminology / comparisons. They also
want to keep the old version in case the new one is worse, and to compare
versions later.

### Options
1. Single row per scope, overwritten on regenerate.
2. Versioned: each generation is a new row with `version = max + 1`,
   composite unique key per scope.
3. Append-only event log + materialized view for "current".

### Decision
Versioned per scope (`(user_id, paper_id)` for summaries / terminology;
`(user_id, paper_a_id, paper_b_id)` for comparisons).

### Consequences
- Regeneration never destroys prior work.
- The "current" view is the latest non-archived version; cheap to query with
  the existing index.
- Storage grows linearly with regeneration count - acceptable since payloads
  are small (~10 KB) and users rarely regenerate more than a few times.
- Diff-between-versions is a future feature with the data already in place.

---

## ADR-010: RLS at every layer (no app-level auth checks)

### Context
Multi-user is a future possibility; the MVP is single-user but should not
need a re-auth refactor later.

### Options
1. App-level checks in every API route (`if (row.user_id !== user.id) 403`).
2. RLS on every user-owned table + RLS-aware Supabase client.
3. Hybrid: RLS plus app-level checks.

### Decision
RLS at every layer. The browser-side anon client + middleware-checked
session cookie are sufficient. The service-role client is only used in the
ingestion pipeline after the API route has already verified ownership.

### Consequences
- A single source of truth for authorization (Postgres policies).
- New tables need exactly one CREATE POLICY statement to be safe.
- Forgotten `WHERE user_id = ...` in queries cannot leak data because RLS
  blocks the read.
- RLS policies must be written carefully - a bad policy permits everything.

---

## ADR-011: Cloudflare Pages over Vercel

### Context
Need a host. Vercel is the obvious default for Next.js; the user's portfolio
domain `research.advien.tech` lives on Cloudflare and they want everything
on one platform.

### Options
1. Vercel (zero-config Next).
2. Cloudflare Pages / Workers via `@opennextjs/cloudflare`.
3. Self-host on a small VM behind a reverse proxy.
4. Render / Railway.

### Decision
Cloudflare Pages via `@opennextjs/cloudflare`.

### Consequences
- DNS, edge caching, CDN, deployments - all on Cloudflare.
- 30 s CPU per request on Free; ingest may need a paid tier or queue.
- `nodejs_compat` flag handles 99% of Next code paths; OpenNext fills the gap.
- One extra build step (`cf:build`) before deploy.
- Bundle size limit 3 MB (Free) / 10 MB (Paid) - currently far under both.

---

## ADR-012: Lightweight UI primitives instead of Radix + shadcn install

### Context
Need Tabs, Collapsible, Drawer, Dropdown menu primitives. Standard answer is
shadcn-cli into Radix.

### Options
1. shadcn-cli + Radix (`@radix-ui/react-tabs`, `react-dropdown-menu`, ...).
2. Hand-rolled minimal primitives in `src/components/ui/*.tsx`.

### Decision
Hand-rolled minimal primitives, copying the shadcn API surface where
relevant (`<Tabs value onValueChange><TabsList><TabsTrigger>...`).

### Consequences
- Smaller bundle, fewer dependencies, simpler types.
- Slight loss of accessibility polish (focus management, keyboard nav) -
  acceptable trade for portfolio scope; documented as a follow-up.
- Easy to swap to Radix later via the same prop API.

---

## ADR-013: Tag vocabulary as a typed structure with aliases

### Context
Need a controlled tag vocabulary spanning multiple domains (prosthetics,
orthotics, robotics, neurorehabilitation, ...) with acronym normalisation
(BCI -> brain-computer-interface, FES -> functional-electrical-stimulation).

### Options
1. Flat string array, prompt Claude to use canonical names.
2. Typed `TagDef` array with category + aliases + helpers.
3. External taxonomy file (CSV, YAML).

### Decision
Typed array of `TagDef { slug, category, label?, aliases? }` in
`src/lib/tags.ts`, with derived flat list (back-compat), category map, and a
`normalizeTag` lookup table.

### Consequences
- Single source of truth.
- New domains added in one place; UI groupings, prompt, and normalisation
  recompute automatically.
- Acronym normalisation handles even cases where Claude prefers the short
  form.
- Backward compatible: the old `PO_TAGS` flat export still works.

---

## ADR-014: Hand-written Citation registry instead of LLM-generated link metadata

### Context
Need every cited claim in summaries / terminology / comparisons to link back
to the exact PDF page even after a reload. The model must not be in the
critical path of resolving citations.

### Options
1. Ask the LLM to return absolute citation objects per field.
2. Number chunks in the prompt, ask the LLM for `citations: number[]` per
   field, resolve to concrete `Citation` objects on the server using the
   numbered registry.
3. Post-process the model output with a fuzzy match between paragraphs and
   chunks.

### Decision
Numbered registry + `citations: number[]` per field. Resolved at write time
(for the user-visible response) and at every read (so links survive forever).

### Consequences
- Model has the smallest possible output surface.
- Hallucinated numbers are dropped silently rather than producing broken
  links.
- The registry travels with the payload, so rendering never re-calls the LLM.
- Costs one indirection in the data structure.

---

## ADR-015: Vitest for the unit / integration test layer

### Context
Need a fast, ESM-native test runner that respects the `@/` path alias from
`tsconfig.json` and runs cleanly in CI without a long compile step.

### Options
1. Jest with `ts-jest` + a custom moduleNameMapper.
2. Jest with `babel-jest`.
3. Vitest (Vite-based, native ESM, native TS).
4. Node's built-in `node:test` plus `tsx`.

### Decision
Vitest, with one `vitest.config.ts` that mirrors the production module
resolver. Test files live in `tests/lib/**`, mirroring `src/lib/**` 1:1.

### Consequences
- 100% reuse of the production module-resolution config.
- Cold-start ~600 ms for the full suite, so `npm run check` is comfortable
  to run pre-commit.
- `vi.fn` / `vi.mock` / fake timers come for free; no extra dep.
- Locked into a Vite-flavoured runner; if we ever migrate to Bun's runner
  the API is similar enough that a port is mechanical.
- Snapshot tests are deliberately not used for prompts (they're tweaked too
  often); we assert invariants instead.

---

## ADR-016: GitHub Actions for CI without exposing real secrets

### Context
CI must enforce lint + typecheck + tests + build on every PR, but the app
calls Anthropic, OpenAI, and Supabase. None of those credentials should be
present in CI.

### Options
1. Run tests against a real Supabase project + real AI keys (slow, fragile,
   leaks secrets into logs).
2. Run tests offline against fakes/mocks; seed dummy env vars in the workflow.
3. Use a recorded-fixture / VCR pattern.

### Decision
Offline tests with dummy env vars seeded in the workflow. The eval harness
(`npm run eval:rag`) is the place where real AI calls happen and lives
outside CI.

### Consequences
- Zero secret exposure in CI logs.
- Fast feedback (~2 minutes for full pipeline).
- Tests can never regress on "did the real Claude API change its response";
  caught instead by the eval harness in pre-deploy.
- One coverage job uploads LCOV artifacts for PR review.

---

## ADR-017: In-memory per-isolate rate limiting

### Context
AI endpoints are expensive (Claude streaming, structured generation,
embedding batches). Need to cap abuse / runaway loops without adding an
external dependency that requires a free-tier account and deploy-time
wiring.

### Options
1. Upstash Redis via `@upstash/ratelimit` (de facto answer for Vercel).
2. Cloudflare KV / Durable Objects (works on Workers, adds binding setup).
3. Postgres-backed counter (correct, but adds a DB hop to every request).
4. In-memory per-isolate fixed-window counter.

### Decision
In-memory per-isolate counter behind a narrow `RateLimiter` interface. The
factory `getRateLimiter()` is the swap-in seam for Upstash / KV / a real
distributed limiter.

### Consequences
- Zero external dependencies, zero deploy-time wiring.
- Correctness is "best-effort per isolate": each isolate caps a single
  attacker by orders of magnitude vs origin uncapped, and a real
  distributed limiter is a one-line factory swap when traffic grows.
- 429 responses include `Retry-After` + `X-RateLimit-*` headers and a JSON
  body the UI parses into a calm "rate limit reached" banner.
- All five AI-touching scopes (chat / upload / ingest / summary /
  terminology / comparison) have their own bucket so a slow comparison
  doesn't starve the chat budget.
- Limits are env-configurable per scope.

---

## ADR-018: Structured JSON logger over a real APM SDK

### Context
Need request-grouped, per-stage observability for the AI pipeline (latency,
token usage, retrieved chunk ids, error class) without adding a heavy SDK
that may not run on Cloudflare Workers / Edge.

### Options
1. Datadog APM SDK / OpenTelemetry + a collector.
2. Sentry for errors + a log shipper for everything else.
3. Pino / winston with custom transports.
4. Hand-written zero-dep JSON logger that writes one line per `console.*`.

### Decision
Hand-written JSON logger (`src/lib/observability/logger.ts`) with a stable
output shape (ISO timestamp, level, dotted event name, request_id,
user_id, route, ...arbitrary fields). The platform's log forwarder
(Cloudflare Logpush, Vercel Logs, Datadog Agent on Node) ingests the lines.

### Consequences
- Runs everywhere our routes run (Edge / Workers / Node).
- Zero deps, zero cold-start cost.
- `classifyError()` maps any thrown value to a small, stable
  `error_type` so dashboards filter by failure mode without pattern-matching
  free text.
- No retries on log delivery — acceptable for observability data.
- No sampling — fine at portfolio scale; would need a `sampleRate` arg
  before million-RPM.
- Sentry-style stack-trace grouping is left to the log pipeline rather than
  the app.

---

## ADR-019: Refusal-grounded RAG (the "no context" placeholder)

### Context
A RAG system that hallucinates with confidence is worse than one that
admits ignorance. The model needs an explicit, prompt-visible signal that
retrieval was empty so it can refuse cleanly.

### Options
1. Skip the LLM call entirely when retrieval is empty. (Loses the chance
   for the model to e.g. ask a clarifying question.)
2. Return an empty string for the context block and hope the model figures
   it out.
3. Return a documented placeholder string the prompt explicitly handles
   (`(no relevant chunks were retrieved from the user's library)`).
4. Let the model decide via a `tool_choice` round-trip.

### Decision
A documented `EMPTY_RETRIEVAL_FALLBACK` placeholder, paired with a system
prompt rule that tells the model to "say so plainly and suggest what the
user could upload" when the context is empty.

### Consequences
- The pipeline is one code path; UI / persistence / streaming all behave
  identically with or without retrieved chunks.
- The eval harness has dedicated refusal probes that assert
  `refusal_correct_rate >= 0.8`.
- The model does occasionally over-refuse on borderline relevance — tuned
  acceptable because the alternative is fabrication.
- Empty top-k still consumes a model call; cheap because the message is
  short.

---

## ADR-020: Inline ingestion + retry policy, queue-ready API

### Context
ADR-008 chose inline ingestion. Production scale needs retries on transient
errors and progress visibility, but does not (yet) justify a real queue.

### Options
1. Keep inline ingestion as-is.
2. Migrate to Cloudflare Queues / Inngest / Trigger.dev today.
3. Keep inline ingestion but factor out an `enqueueIngest()` indirection
   plus retry policy + per-stage progress.

### Decision
Option 3. The `papers.status` enum gains `summarizing` and `retrying`. A
DB trigger stamps `ingest_started_at` / `ingest_finished_at` / increments
`ingest_attempts` so the UI sees progress without polling the worker.
`enqueueIngest()` is the single seam a future queue migration changes.

### Consequences
- 90% of the operational benefit of a queue (visible progress, transient
  retry, no lost rows on failure) for 0% of the infrastructure tax.
- Cloudflare Workers Free CPU cap is still a real risk for very long
  papers; documented in the deployment doc.
- Migration to Cloudflare Queues / Inngest is mechanical: replace the body
  of `enqueueIngest()` with a `queue.send({ paperId })` call and host the
  consumer that wraps `ingestPaper()` with `maxAttempts: 3`.
- `isTransient(errorType)` keeps the retry policy small and explicit.

---

## Performance considerations

- **Embedding batches** are capped at 96 inputs per call to stay under
  OpenAI per-call timeouts and rate-limit-safe.
- **Chunk inserts** are batched at 100 rows per `INSERT` for sane payload
  size.
- **Sidebar pagination** is keyset-based on `(last_message_at, id)` to keep
  it cheap as conversation count grows.
- **Tag filter** computes group counts in `useMemo` over the in-memory paper
  list (cheap; no extra DB query).
- **Realtime sub** has one channel per user; library updates are O(1) per
  status flip.
- **HNSW** parameters (`m=16, ef_construction=64`) are pgvector defaults
  appropriate for tens of thousands of vectors per user. Re-tune if recall
  drops at higher counts.

## Future scalability considerations

- **Ingestion at scale**: queue + worker (see roadmap).
- **Vector store at >1M vectors / user**: external store (Qdrant, Pinecone)
  via a periodic sync job.
- **Realtime fan-out** (multi-user teams): channel per workspace, not per
  user.
- **PDF storage growth**: lifecycle policy on Storage to drop older PDFs
  after a grace period (with embeddings retained).
- **Cost control**: per-user usage caps + a free-tier degraded path
  (smaller k, fewer chunks per regenerate).
- **Reranking** for top-N results to improve precision once corpus diversity
  exceeds what pure ANN handles.
- **OCR**: optional Claude vision fallback for scanned papers; degrade to
  per-page extraction with caching.
