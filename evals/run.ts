/* eslint-disable no-console */
/**
 * RAG evaluation runner.
 *
 * Why this exists:
 *   Unit tests verify individual library functions; this harness verifies the
 *   end-to-end RAG pipeline against a real, deployed instance and aggregates
 *   measurable metrics (retrieval hit rate, citation coverage, refusal rate,
 *   p50 / p95 latency). Run it before / after every prompt or retrieval
 *   change to catch regressions you cannot see in unit tests.
 *
 * How it works:
 *   1. Loads `evals/rag-eval.json` (or any file passed via --dataset).
 *   2. For each item, POSTs to `${POAR_API_URL}/api/chat` with the question.
 *   3. Reads the streamed response (citations annotation + assistant text).
 *   4. Computes metrics per item and globally, then prints a JSON+table report.
 *
 * Usage:
 *   POAR_API_URL=http://localhost:3000 \
 *   POAR_AUTH_COOKIE='sb-access-token=...; sb-refresh-token=...' \
 *   POAR_PAPER_ID=<uuid> \
 *   npm run eval:rag
 *
 * Optional flags:
 *   --dataset <path>   alternate dataset file
 *   --json <path>      write the full report to a file as well
 *   --limit <n>        run only the first n items
 *
 * The `POAR_PAPER_ID` env var scopes evaluation to a single paper. Leave it
 * unset to evaluate cross-library retrieval. The `expected_keywords` field
 * is matched against retrieved chunk *content* (case-insensitive); the
 * `expected_answer_contains` field is matched against the assistant text.
 */

import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

type EvalItem = {
  id: string;
  question: string;
  /** Words/phrases we expect to see in at least one retrieved chunk. */
  expected_keywords?: string[];
  /** Phrases we expect to see in the final assistant answer (case-insensitive). */
  expected_answer_contains?: string[];
  /** When true, we expect a refusal-style answer ("not in context") with zero citations. */
  expect_no_context?: boolean;
  /** Optional paper scoping override (UUID). */
  paper_id?: string | null;
  notes?: string;
};

type EvalCitation = {
  n: number;
  chunk_id: string;
  paper_id: string;
  page_start: number | null;
  page_end: number | null;
  snippet: string;
};

type EvalResult = {
  id: string;
  question: string;
  status: "ok" | "error";
  retrieved_chunks: number;
  retrieved_chunk_ids: string[];
  retrieval_hit: boolean;     // any expected_keyword appeared in any chunk snippet
  citations_used: number;
  answer: string;
  answer_match: boolean;      // any expected_answer_contains appeared in the answer
  refusal_detected: boolean;  // looks like a "no context" answer
  refusal_correct: boolean | null; // null when expect_no_context not set
  latency_ms: number;
  error?: string;
};

type Cli = { dataset: string; jsonOut: string | null; limit: number | null };

function parseArgs(argv: string[]): Cli {
  const cli: Cli = {
    dataset: resolve(process.cwd(), "evals/rag-eval.json"),
    jsonOut: null,
    limit: null,
  };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dataset") cli.dataset = resolve(process.cwd(), argv[++i]);
    else if (a === "--json") cli.jsonOut = resolve(process.cwd(), argv[++i]);
    else if (a === "--limit") cli.limit = Number.parseInt(argv[++i], 10);
  }
  return cli;
}

const REFUSAL_RE =
  /(no\s+(relevant\s+)?context|i\s+don't\s+have|not\s+(in\s+the\s+)?context|cannot\s+find|no\s+information|nothing\s+(relevant|in\s+(your\s+)?library)|(unable|cannot)\s+to\s+answer|do\s+not\s+have)/i;

function detectRefusal(text: string, citationsUsed: number): boolean {
  if (!text) return true;
  if (citationsUsed === 0 && text.length < 600) return true;
  return REFUSAL_RE.test(text);
}

function answerMatches(answer: string, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const a = answer.toLowerCase();
  return needles.some((n) => a.includes(n.toLowerCase()));
}

function retrievalHit(citations: EvalCitation[], keywords: string[] | undefined): boolean {
  if (!keywords || keywords.length === 0) return citations.length > 0;
  const blob = citations.map((c) => c.snippet).join("\n").toLowerCase();
  return keywords.some((k) => blob.includes(k.toLowerCase()));
}

/**
 * Read the AI SDK data-stream response. Each line is either:
 *   - "0:\"text-token\""  -> assistant content delta
 *   - "2:[ ...annotations ]"  -> data annotation array (we use {type: "citations"})
 *   - "d:{...}" / "e:{...}"   -> finish events
 * Other prefixes exist for tool calls etc. but are not used here.
 */
async function consumeChatStream(res: Response): Promise<{
  text: string;
  citations: EvalCitation[];
}> {
  const reader = res.body?.getReader();
  if (!reader) return { text: "", citations: [] };
  const decoder = new TextDecoder();
  let buf = "";
  let text = "";
  let citations: EvalCitation[] = [];
  while (true) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split("\n");
    buf = lines.pop() ?? "";
    for (const line of lines) {
      if (!line) continue;
      const idx = line.indexOf(":");
      if (idx < 0) continue;
      const tag = line.slice(0, idx);
      const rest = line.slice(idx + 1);
      try {
        if (tag === "0") {
          text += JSON.parse(rest);
        } else if (tag === "2") {
          const arr = JSON.parse(rest);
          if (Array.isArray(arr)) {
            for (const a of arr) {
              if (a && a.type === "citations" && Array.isArray(a.citations)) {
                citations = a.citations as EvalCitation[];
              }
            }
          }
        }
      } catch {
        /* ignore malformed lines */
      }
    }
  }
  return { text, citations };
}

async function runOne(item: EvalItem, env: { url: string; cookie: string; paperId: string | null }): Promise<EvalResult> {
  const start = Date.now();
  const url = `${env.url.replace(/\/$/, "")}/api/chat`;
  const body = JSON.stringify({
    messages: [{ role: "user", content: item.question }],
    paper_id: item.paper_id ?? env.paperId ?? null,
    chat_id: null,
  });

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: env.cookie,
      },
      body,
    });
    if (!res.ok) {
      const errText = await res.text();
      return errorResult(item, Date.now() - start, `HTTP ${res.status}: ${errText.slice(0, 300)}`);
    }
    const { text, citations } = await consumeChatStream(res);
    const refusalDetected = detectRefusal(text, citations.length);
    const refusalCorrect =
      typeof item.expect_no_context === "boolean"
        ? refusalDetected === item.expect_no_context
        : null;
    return {
      id: item.id,
      question: item.question,
      status: "ok",
      retrieved_chunks: citations.length,
      retrieved_chunk_ids: citations.map((c) => c.chunk_id),
      retrieval_hit: retrievalHit(citations, item.expected_keywords),
      citations_used: citations.length,
      answer: text,
      answer_match: answerMatches(text, item.expected_answer_contains),
      refusal_detected: refusalDetected,
      refusal_correct: refusalCorrect,
      latency_ms: Date.now() - start,
    };
  } catch (e) {
    return errorResult(item, Date.now() - start, e instanceof Error ? e.message : String(e));
  }
}

function errorResult(item: EvalItem, latency: number, msg: string): EvalResult {
  return {
    id: item.id,
    question: item.question,
    status: "error",
    retrieved_chunks: 0,
    retrieved_chunk_ids: [],
    retrieval_hit: false,
    citations_used: 0,
    answer: "",
    answer_match: false,
    refusal_detected: false,
    refusal_correct: null,
    latency_ms: latency,
    error: msg,
  };
}

function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}

function summarize(results: EvalResult[]) {
  const ok = results.filter((r) => r.status === "ok");
  const expected = ok.filter((r) => r.refusal_correct !== null);
  const grounded = ok.filter((r) => r.refusal_correct === null || r.refusal_correct === false);
  const total = results.length;
  const errors = results.length - ok.length;
  const lat = ok.map((r) => r.latency_ms);

  return {
    total,
    errors,
    retrieval_hit_rate: ok.length
      ? grounded.filter((r) => r.retrieval_hit).length / Math.max(1, grounded.length)
      : 0,
    citation_coverage_rate: ok.length
      ? grounded.filter((r) => r.citations_used > 0).length / Math.max(1, grounded.length)
      : 0,
    answer_match_rate: ok.length
      ? grounded.filter((r) => r.answer_match).length / Math.max(1, grounded.length)
      : 0,
    refusal_correct_rate: expected.length
      ? expected.filter((r) => r.refusal_correct).length / expected.length
      : null,
    latency: {
      p50_ms: percentile(lat, 50),
      p95_ms: percentile(lat, 95),
      max_ms: Math.max(0, ...lat),
      avg_ms: lat.length ? Math.round(lat.reduce((s, v) => s + v, 0) / lat.length) : 0,
    },
  };
}

async function main() {
  const cli = parseArgs(process.argv);

  const url = process.env.POAR_API_URL ?? "http://localhost:3000";
  const cookie = process.env.POAR_AUTH_COOKIE ?? "";
  const paperId = process.env.POAR_PAPER_ID ?? null;
  if (!cookie) {
    console.error(
      "[eval] POAR_AUTH_COOKIE is required. Sign in to your local dev server,\n" +
        "       copy the `sb-access-token` + `sb-refresh-token` cookie pair from\n" +
        "       devtools, and export them as POAR_AUTH_COOKIE before running."
    );
    process.exit(2);
  }

  let dataset: EvalItem[] = JSON.parse(readFileSync(cli.dataset, "utf-8"));
  if (cli.limit) dataset = dataset.slice(0, cli.limit);

  console.log(`[eval] dataset=${cli.dataset} items=${dataset.length} target=${url} paper_id=${paperId ?? "<library>"}`);
  const results: EvalResult[] = [];
  for (const item of dataset) {
    const r = await runOne(item, { url, cookie, paperId });
    results.push(r);
    process.stdout.write(
      `  - ${item.id.padEnd(20)} ` +
        `${r.status === "ok" ? "OK " : "ERR"} ` +
        `chunks=${String(r.retrieved_chunks).padEnd(2)} ` +
        `hit=${r.retrieval_hit ? "y" : "n"} ` +
        `match=${r.answer_match ? "y" : "n"} ` +
        `refusal=${r.refusal_detected ? "y" : "n"}` +
        (r.refusal_correct === null ? "" : `(${r.refusal_correct ? "ok" : "FAIL"})`) +
        ` ${r.latency_ms}ms` +
        (r.error ? `  err=${r.error.slice(0, 80)}` : "") +
        "\n"
    );
  }

  const summary = summarize(results);

  console.log("\n=== Summary ===");
  console.log(JSON.stringify(summary, null, 2));

  if (cli.jsonOut) {
    writeFileSync(cli.jsonOut, JSON.stringify({ summary, results }, null, 2));
    console.log(`[eval] full report written to ${cli.jsonOut}`);
  }

  // Non-zero exit on regression: any error item, or retrieval hit < 70%, or
  // refusal accuracy < 80% (when refusal probes exist).
  const failed =
    summary.errors > 0 ||
    summary.retrieval_hit_rate < 0.7 ||
    (summary.refusal_correct_rate !== null && summary.refusal_correct_rate < 0.8);
  process.exit(failed ? 1 : 0);
}

main().catch((e) => {
  console.error("[eval] fatal:", e);
  process.exit(2);
});
