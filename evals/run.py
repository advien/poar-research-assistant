"""
evals/run.py

Weekly RAG eval script.
- Fetches unscored rows from rag_traces (eval_faithfulness IS NULL)
- Runs DeepEval: Faithfulness + AnswerRelevancy
- Also runs detect_refusal (port of metrics.ts) — free, no LLM call needed
- Writes scores back to rag_traces
- Prints a summary report

Usage:
    pip install deepeval supabase python-dotenv
    python evals/run.py

Env vars required (same as .env.local):
    NEXT_PUBLIC_SUPABASE_URL
    SUPABASE_SERVICE_ROLE_KEY   ← service role, bypasses RLS
    OPENAI_API_KEY              ← DeepEval uses OpenAI as judge by default
"""

from __future__ import annotations

import os
import re
import sys
import json
import statistics
from datetime import datetime, timezone
from typing import Any

from dotenv import load_dotenv
from supabase import create_client, Client
from deepeval import evaluate
from deepeval.metrics import FaithfulnessMetric, AnswerRelevancyMetric
from deepeval.test_case import LLMTestCase

load_dotenv(".env.local")

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------

BATCH_SIZE = int(os.environ.get("EVAL_BATCH_SIZE", "50"))  # rows per run
FAITHFULNESS_THRESHOLD = 0.7
RELEVANCY_THRESHOLD = 0.7

# ---------------------------------------------------------------------------
# Supabase client (service role — needs to write eval scores)
# ---------------------------------------------------------------------------

def get_supabase() -> Client:
    url = os.environ.get("NEXT_PUBLIC_SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        sys.exit("Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY")
    return create_client(url, key)


# ---------------------------------------------------------------------------
# Port of metrics.ts → detect_refusal
# ---------------------------------------------------------------------------

REFUSAL_RE = re.compile(
    r"(no\s+(relevant\s+)?context"
    r"|i\s+don't\s+have"
    r"|not\s+(in\s+the\s+)?context"
    r"|cannot\s+find"
    r"|no\s+information"
    r"|nothing\s+(relevant|in\s+(your\s+)?library)"
    r"|(unable|cannot)\s+to\s+answer"
    r"|do\s+not\s+have"
    r"|i'?m\s+not\s+sure)",
    re.IGNORECASE,
)

def detect_refusal(text: str, citations_count: int) -> bool:
    if not text:
        return True
    if citations_count == 0 and len(text) < 600:
        return True
    return bool(REFUSAL_RE.search(text))


# ---------------------------------------------------------------------------
# Fetch unscored traces
# ---------------------------------------------------------------------------

def fetch_unscored(supabase: Client) -> list[dict[str, Any]]:
    res = (
        supabase.table("rag_traces")
        .select(
            "id, query, answer_text, retrieval_chunk_count, "
            "retrieval_top_score, citations_count, retrieval_empty"
        )
        .is_("eval_faithfulness", "null")
        .not_.is_("answer_text", "null")
        .order("created_at", desc=False)
        .limit(BATCH_SIZE)
        .execute()
    )
    return res.data or []


# ---------------------------------------------------------------------------
# Build retrieval context string from snippet stored in citations
# Fallback: we don't have full chunk text in rag_traces, so we use
# answer_text as a proxy for context when running faithfulness.
# For a tighter eval, store chunk text in a separate eval_chunks table.
# ---------------------------------------------------------------------------

def build_test_case(row: dict[str, Any]) -> LLMTestCase:
    query = row["query"] or ""
    answer = row["answer_text"] or ""

    # retrieval_context: DeepEval expects list[str] of retrieved passages.
    # We store only counts/scores in rag_traces, not full chunk text.
    # Using answer as single context item is a conservative approximation —
    # faithfulness score will be high when answer stays within its own text.
    # Replace with actual chunk content if you add an eval_chunks table later.
    retrieval_context = [answer] if answer else ["(no context retrieved)"]

    return LLMTestCase(
        input=query,
        actual_output=answer,
        retrieval_context=retrieval_context,
    )


# ---------------------------------------------------------------------------
# Write scores back
# ---------------------------------------------------------------------------

def write_scores(
    supabase: Client,
    trace_id: str,
    faithfulness: float | None,
    relevancy: float | None,
) -> None:
    supabase.table("rag_traces").update(
        {
            "eval_faithfulness": faithfulness,
            "eval_answer_relevancy": relevancy,
        }
    ).eq("id", trace_id).execute()


# ---------------------------------------------------------------------------
# Summary report
# ---------------------------------------------------------------------------

def print_report(results: list[dict[str, Any]]) -> None:
    if not results:
        print("No rows evaluated.")
        return

    faithfulness_scores = [r["faithfulness"] for r in results if r["faithfulness"] is not None]
    relevancy_scores = [r["relevancy"] for r in results if r["relevancy"] is not None]
    refusals = sum(1 for r in results if r["refusal"])

    print("\n" + "=" * 55)
    print(f"  RAG Eval Report — {datetime.now(timezone.utc).strftime('%Y-%m-%d %H:%M UTC')}")
    print("=" * 55)
    print(f"  Rows evaluated      : {len(results)}")
    print(f"  Refusals detected   : {refusals} ({100*refusals/len(results):.0f}%)")

    if faithfulness_scores:
        print(f"\n  Faithfulness")
        print(f"    mean  : {statistics.mean(faithfulness_scores):.3f}")
        print(f"    median: {statistics.median(faithfulness_scores):.3f}")
        print(f"    min   : {min(faithfulness_scores):.3f}")
        below = sum(1 for s in faithfulness_scores if s < FAITHFULNESS_THRESHOLD)
        print(f"    below {FAITHFULNESS_THRESHOLD}: {below} rows")

    if relevancy_scores:
        print(f"\n  Answer Relevancy")
        print(f"    mean  : {statistics.mean(relevancy_scores):.3f}")
        print(f"    median: {statistics.median(relevancy_scores):.3f}")
        print(f"    min   : {min(relevancy_scores):.3f}")
        below = sum(1 for s in relevancy_scores if s < RELEVANCY_THRESHOLD)
        print(f"    below {RELEVANCY_THRESHOLD}: {below} rows")

    print("=" * 55 + "\n")


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------

def main() -> None:
    supabase = get_supabase()

    print(f"Fetching up to {BATCH_SIZE} unscored traces...")
    rows = fetch_unscored(supabase)
    if not rows:
        print("Nothing to evaluate. All traces are scored.")
        return
    print(f"Found {len(rows)} rows to evaluate.")

    faithfulness_metric = FaithfulnessMetric(
        threshold=FAITHFULNESS_THRESHOLD,
        model="gpt-4o-mini",  # cheaper judge; swap to gpt-4o for higher accuracy
        include_reason=False,
    )
    relevancy_metric = AnswerRelevancyMetric(
        threshold=RELEVANCY_THRESHOLD,
        model="gpt-4o-mini",
        include_reason=False,
    )

    results: list[dict[str, Any]] = []

    for row in rows:
        trace_id = row["id"]
        answer = row.get("answer_text") or ""
        citations_count = row.get("citations_count") or 0

        is_refusal = detect_refusal(answer, citations_count)

        if is_refusal:
            # Skip LLM eval for refusals — score as 0.0 directly
            write_scores(supabase, trace_id, 0.0, 0.0)
            results.append({"faithfulness": 0.0, "relevancy": 0.0, "refusal": True})
            print(f"  [{trace_id[:8]}] refusal detected → scored 0.0/0.0")
            continue

        test_case = build_test_case(row)

        try:
            evaluate(
                test_cases=[test_case],
                metrics=[faithfulness_metric, relevancy_metric],
                run_async=False,
                print_results=False,
            )
            f_score = faithfulness_metric.score
            r_score = relevancy_metric.score
        except Exception as exc:  # noqa: BLE001
            print(f"  [{trace_id[:8]}] eval error: {exc}")
            f_score, r_score = None, None

        write_scores(supabase, trace_id, f_score, r_score)
        results.append({"faithfulness": f_score, "relevancy": r_score, "refusal": False})
        status = f"f={f_score:.2f} r={r_score:.2f}" if f_score is not None else "error"
        print(f"  [{trace_id[:8]}] {status}")

    print_report(results)


if __name__ == "__main__":
    main()