# Testing

POAR Research Assistant uses [Vitest](https://vitest.dev) as the single test
runner. Tests are pure unit / integration-style tests against the library code
in `src/lib/**` — they do **not** boot a Next.js server, never hit a real
Supabase project, and never call OpenAI or Anthropic. Fakes, mocks, and tiny
fixtures replace I/O at the function-call boundary.

## Why Vitest

- Same module resolver as the app (Vite + ESM), so the `@/...` path alias from
  `tsconfig.json` works without a separate Jest moduleNameMapper.
- TypeScript out of the box, no `ts-jest` / Babel pipeline.
- Native ESM, `vi.mock`, `vi.fn`, watch mode, and v8 coverage in one
  dependency.
- Fast cold start (~600 ms for the full suite at the time of writing) so
  `npm run test` is comfortable inside `npm run check`.

## Running tests

```bash
npm run test            # run once (CI mode)
npm run test:watch      # interactive watcher
npm run test:coverage   # v8 coverage report (text + html + lcov)
npm run check           # lint + typecheck + tests
```

`npm run check` is the single command CI and pre-push hooks should run. It
fails on any lint warning, type error, or failing test.

## Layout

```
tests/
  setup.ts                              global vitest setup
  lib/
    ai/prompts.test.ts                  RAG / metadata / summary system prompts
    analyses/paperContext.test.ts       1-indexed citation resolution
    api/schemas.test.ts                 Zod request validation
    ingest/chunk.test.ts                token-aware chunker
    rag/retrieve.test.ts                retrieval + integration-style RAG test
```

The directory mirrors `src/lib/**` one-to-one so `path/to/X.ts` ↔
`tests/path/to/X.test.ts` is unambiguous. Configuration lives in
[`vitest.config.ts`](../../vitest.config.ts) at the repo root.

## What is covered today

| Area | Test file | What it asserts |
| --- | --- | --- |
| **Chunking** | `tests/lib/ingest/chunk.test.ts` | Token budget, page tracking, paragraph integrity, section detection (sticky), oversize-paragraph fallback, no empty chunks. |
| **Prompt construction** | `tests/lib/ai/prompts.test.ts` | RAG prompt instructs `[n]` citations and forbids fabrication; `buildContextBlock` emits 1-indexed numbered chunks with the right page label form (`p.4` / `pp.7-8` / `p.?`). |
| **Citation resolution** | `tests/lib/analyses/paperContext.test.ts` | 1-indexed numeric refs (`resolveCitationRefs`), comparison `A1` / `B1` refs (`resolveComparisonRefs`), out-of-range hallucinated refs are silently dropped, dedupe, stored summary re-resolution. |
| **Retrieval (unit)** | `tests/lib/rag/retrieve.test.ts` | Happy path 1-indexed citations, context block format, empty top-k → `EMPTY_RETRIEVAL_FALLBACK`, `match_chunks` RPC error path, parameter forwarding (`filter_paper_id`, `match_count`). |
| **Retrieval (integration-style RAG)** | `tests/lib/rag/retrieve.test.ts` | The canonical "What dataset was used?" probe: a fixture library where the dataset chunk has the highest similarity is fed into `retrieveContext`, and the test asserts the dataset chunk is `chunks[0]`, present in the citation registry, and surfaces in the numbered context block. This is the closest you can get to a real RAG end-to-end test without spinning up Postgres. |
| **API validation** | `tests/lib/api/schemas.test.ts` | Every request schema (`/api/chat`, `/api/papers/upload`, `/api/papers/ingest`, `/api/comparisons`, `/api/search`) accepts the well-formed payload and rejects malformed payloads (empty messages, non-UUID, oversize content, zero file size, >100 MB upload, etc.). The `safeParse` helper that every route uses is asserted to return both `ok: true` and `ok: false` discriminated unions. |
| **Empty / malformed handling** | `tests/lib/rag/retrieve.test.ts` + `tests/lib/api/schemas.test.ts` | Null payload from RPC behaves like empty; route schemas reject `undefined`, `null`, raw strings, and unknown roles. |

The integration-style test is the most important one for RAG quality
regressions: if anything between the embedder, the RPC contract, the citation
numbering, or the context block builder breaks, that single test fails first.

## Conventions

- **Fakes over mocks where possible.** Retrieval tests build a tiny
  `fakeSupabase({ data, error })` instead of `vi.mock`-ing the module; the
  retriever has a `embedder` injection point so we never have to monkey-patch
  the OpenAI module.
- **No environment access in tests.** `tests/setup.ts` seeds the bare-minimum
  env vars so any module that lazily reads `process.env.*` at import time does
  not throw. Never read `process.env` from inside a test body.
- **One assertion theme per `it()`.** Tests are named after the property they
  prove (`"never splits a paragraph - a single oversize paragraph becomes one
  chunk"`).
- **No snapshots for prompts.** Prompts are tweaked frequently. Tests assert
  the *invariants* that matter (`/cite/i`, `/never invent/`, presence of the
  POAR domain primer) instead of byte-for-byte equality.

## What is NOT covered (yet)

- **Live database / RPC behaviour** — `match_chunks` and `hybrid_search`
  correctness rely on PostgREST + pgvector. Covered manually + via the
  RAG eval runner (see [`docs/engineering/evaluation.md`](evaluation.md)).
- **End-to-end browser tests** — out of scope for the portfolio cut.
- **Realtime / streaming protocol** — `createDataStreamResponse` is exercised
  manually; a future test could spin up `next start` and assert SSE framing.
- **Rate-limit / observability layers** — covered by integration tests
  alongside their respective utilities.

## Adding a new test

1. Create the file under `tests/lib/<area>/<name>.test.ts`.
2. Import the symbol under test via the `@/` alias.
3. Prefer dependency-injection (`embedder`, `supabase`, `clock`) over module
   mocking when the module under test exposes an injection point.
4. If you need a Supabase-shaped fake, copy the `fakeSupabase` helper from
   `tests/lib/rag/retrieve.test.ts`.
5. Run `npm run test` once to confirm it passes, then `npm run check` to
   confirm the broader sweep is still green.

## Coverage

`npm run test:coverage` writes a v8 coverage report covering the AI / RAG
surface (`src/lib/ingest`, `src/lib/ai`, `src/lib/analyses`, `src/lib/api`,
`src/lib/rag`, `src/lib/observability`, `src/lib/rate-limit`). UI components
and Supabase clients are deliberately excluded from coverage — their failure
modes are caught by typecheck + manual exercise rather than unit tests.

The HTML report lands in `coverage/`. Open `coverage/index.html` for a clickable
file-by-file view.
