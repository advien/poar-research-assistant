# RAG Evaluation

POAR ships a small, runnable evaluation harness so prompt or retrieval
changes can be measured rather than guessed at. The harness is **not** a
synthetic benchmark — it sends real questions through a real deployed
instance, reads the streaming response, and aggregates the metrics that
matter for a production RAG system:

- **Retrieval hit rate** — was a relevant chunk in the top-k?
- **Citation coverage** — did the answer include at least one `[n]` citation?
- **Answer match** — did the answer contain the expected phrasing?
- **Refusal correctness** — for out-of-corpus questions, did the model refuse
  cleanly instead of inventing facts?
- **Latency** — p50, p95, max wall-clock per question.

## Files

| File | Purpose |
| --- | --- |
| `evals/rag-eval.json` | The eval dataset. Eight items today: six retrieval probes, two refusal probes. |
| `evals/run.ts` | Node CLI runner. Reads the dataset, hits `/api/chat`, computes metrics, prints a table + JSON summary. |
| `npm run eval:rag` | Entry point. |

## Item shape

```jsonc
{
  "id": "dataset-1",
  "question": "What dataset was used to train the controller?",
  // The retriever is "hit" if any of these substrings appears in any
  // returned chunk's snippet. Case-insensitive.
  "expected_keywords": ["dataset", "subjects", "recordings"],
  // The answer "matches" if any of these substrings appears in the model
  // response text. Case-insensitive.
  "expected_answer_contains": ["dataset"],
  // When true, we expect a "no relevant context" refusal. Refusal items
  // are excluded from retrieval / citation metrics and counted only against
  // refusal accuracy.
  "expect_no_context": false,
  // Optional: scope to a specific paper UUID (overrides POAR_PAPER_ID).
  "paper_id": null,
  "notes": "Optional human description."
}
```

## Running

The runner is intentionally HTTP-based so you measure the *deployed* system,
not the test fixture. You need:

1. A running POAR instance. Local works (`npm run dev`) or any deployed URL.
2. An authenticated session cookie. Sign in via the magic-link flow, then
   copy the `sb-access-token` and `sb-refresh-token` cookies from devtools.
3. A paper id to scope retrieval to (recommended for repeatability).

```bash
export POAR_API_URL=http://localhost:3000
export POAR_AUTH_COOKIE='sb-access-token=...; sb-refresh-token=...'
export POAR_PAPER_ID=11111111-1111-1111-1111-111111111111   # optional

npm run eval:rag                                  # run with default dataset
npm run eval:rag -- --dataset evals/custom.json   # custom dataset
npm run eval:rag -- --limit 3                      # smoke run
npm run eval:rag -- --json out/rag-report.json    # save full report
```

## Output

Per-item line:

```
  - dataset-1            OK  chunks=8  hit=y match=y refusal=n 1340ms
  - out-of-corpus-1      OK  chunks=0  hit=n match=y refusal=y(ok) 510ms
```

Aggregate summary (excerpt):

```json
{
  "total": 8,
  "errors": 0,
  "retrieval_hit_rate": 1.0,
  "citation_coverage_rate": 1.0,
  "answer_match_rate": 0.83,
  "refusal_correct_rate": 1.0,
  "latency": {
    "p50_ms": 1180,
    "p95_ms": 1730,
    "max_ms": 1840,
    "avg_ms": 1300
  }
}
```

## Exit codes & CI

The runner returns a non-zero exit code when:

- Any item errors (HTTP 4xx / 5xx, timeout).
- `retrieval_hit_rate < 0.7`.
- `refusal_correct_rate < 0.8` (when refusal probes exist).

This makes it suitable to gate deploys on. We deliberately do **not** run it
in the GitHub Actions CI workflow (it would need real Anthropic + OpenAI
credentials and a populated Supabase instance), but the same script can run
from a deploy-time job that already has those secrets.

## How metrics are computed

Refusal probes are excluded from retrieval / citation / match metrics —
otherwise the "what does this paper say about quantum computing" question
would deflate retrieval hit rate even when the model correctly says it has
no context. They contribute to `refusal_correct_rate` instead.

Refusal detection is a heuristic on the assistant text:

```
/(no\s+(relevant\s+)?context|i\s+don't\s+have|not\s+(in\s+the\s+)?context|cannot\s+find|...)/i
```

When in doubt the runner treats short answers (< 600 chars) with **zero**
citations as refusals. This is biased toward false-positive refusal
detection (good — fabrication with citations is the worst case and would
*not* trip this).

## What the eval does NOT measure

- **Numeric accuracy.** "Did the model report 87.3% vs 87.4%?" is out of
  scope; for that we'd need a ground-truth answer key per paper.
- **Citation precision.** We assert at least one citation exists, not that
  the cited page actually supports the claim. A future improvement is to
  re-embed each cited chunk + claim sentence and check cosine similarity.
- **Streaming smoothness.** We block until the stream completes — TTFT
  metrics belong in a load test, not a correctness eval.
- **Cross-paper synthesis.** All probes are single-paper. A library-wide
  synthesis evaluator would need a different harness.

## Adding a new probe

1. Append an item to `evals/rag-eval.json`. Pick a stable `id` so trend
   reports work.
2. For positive probes, list `expected_keywords` that should appear in any
   retrieved chunk. Keep them broad enough to survive paraphrase.
3. For refusal probes, set `expect_no_context: true` and leave keywords
   empty.
4. Run `npm run eval:rag --limit <new index + 1>` to validate quickly, then
   the full suite.

## Future improvements

- **Per-claim citation faithfulness** via cross-encoder re-scoring.
- **NDCG / MRR** for retrieval ordering when ground-truth chunk ids are
  available.
- **Cost per question** (Anthropic + OpenAI usage from the structured
  logs) included in the summary.
- **Run history** persisted in a `evals/results/` folder so you can diff
  yesterday's report against today's.
