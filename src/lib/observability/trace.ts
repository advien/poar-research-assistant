/**
 * lib/observability/trace.ts
 *
 * Fire-and-forget trace writer for RAG requests.
 * Writes one row to `rag_traces` after each completed generation.
 * Never throws — a trace failure must not affect the user response.
 *
 * Usage (inside route.ts onFinish):
 *   await writeTrace(supabase, log, { ...fields });
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Logger } from "@/lib/observability/logger";
import type { MatchedChunk } from "@/lib/rag/retrieve";

export type TracePayload = {
  requestId: string;
  userId: string;
  chatId: string;
  paperId: string | null;
  query: string;
  model: string;

  // retrieval
  retrievalLatencyMs: number;
  chunks: MatchedChunk[];
  retrievalEmpty: boolean;

  // generation (from onFinish)
  generationLatencyMs: number;
  totalLatencyMs: number;
  inputTokens: number | null;
  outputTokens: number | null;
  finishReason: string;
  citationsCount: number;
  answerText: string;
};

export async function writeTrace(
  supabase: SupabaseClient,
  log: Logger,
  p: TracePayload
): Promise<void> {
  try {
    const topScore =
      p.chunks.length > 0
        ? Math.max(...p.chunks.map((c) => c.similarity))
        : null;

    const { error } = await supabase.from("rag_traces").insert({
      request_id: p.requestId,
      user_id: p.userId,
      chat_id: p.chatId,
      paper_id: p.paperId,
      query: p.query,
      model: p.model,

      retrieval_latency_ms: p.retrievalLatencyMs,
      retrieval_chunk_count: p.chunks.length,
      retrieval_top_score: topScore,
      retrieval_empty: p.retrievalEmpty,

      generation_latency_ms: p.generationLatencyMs,
      total_latency_ms: p.totalLatencyMs,
      input_tokens: p.inputTokens,
      output_tokens: p.outputTokens,
      finish_reason: p.finishReason,
      citations_count: p.citationsCount,
      answer_text: p.answerText,
    });

    if (error) {
      log.warn("trace.write.failed", { error_type: "supabase", message: error.message });
    } else {
      log.debug("trace.write.done", { request_id: p.requestId });
    }
  } catch (err) {
    // Swallow — trace write must never break the response
    log.warn("trace.write.exception", {
      message: err instanceof Error ? err.message : String(err),
    });
  }
}