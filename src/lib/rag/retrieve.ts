import type { SupabaseDbClient } from "@/lib/supabase/server";
import type { Citation } from "@/types/db";
import { buildContextBlock } from "@/lib/ai/prompts";

/** Shape of one row returned by the `match_chunks` Supabase RPC. */
export type MatchedChunk = {
  id: string;
  paper_id: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  section: string | null;
  content: string;
  similarity: number;
};

export type RetrievalResult = {
  chunks: MatchedChunk[];
  citations: Citation[];
  /** Numbered Claude-ready context block. Always non-empty:
   *  falls back to a documented placeholder when nothing was retrieved so
   *  the model can answer with the "I don't have context for that" fallback. */
  contextBlock: string;
  /** True when the retriever returned zero rows. The caller can use this to
   *  skip the LLM entirely, suppress citation rendering, or surface a message. */
  empty: boolean;
};

const EMPTY_CONTEXT_FALLBACK =
  "(no relevant chunks were retrieved from the user's library)";

/**
 * RAG retrieval. Embeds the query, hits the `match_chunks` RPC under RLS,
 * and returns Citation[] + a numbered context block ready to drop into the
 * Claude system prompt. Pure-ish so it's straightforward to unit-test by
 * passing a fake supabase client and a fake embedder.
 */
export async function retrieveContext(args: {
  supabase: SupabaseDbClient;
  query: string;
  paperId?: string | null;
  k?: number;
  embedder: (text: string) => Promise<number[]>;
}): Promise<RetrievalResult> {
  const k = args.k ?? (args.paperId ? 8 : 12);
  const queryEmbedding = await args.embedder(args.query);

  const { data, error } = await args.supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: k,
    filter_paper_id: args.paperId ?? null,
  });
  if (error) {
    throw new Error(`retrieval failed: ${error.message}`);
  }

  const chunks = (data ?? []) as MatchedChunk[];
  const citations: Citation[] = chunks.map((c, i) => ({
    n: i + 1,
    chunk_id: c.id,
    paper_id: c.paper_id,
    page_start: c.page_start,
    page_end: c.page_end,
    snippet: c.content.slice(0, 240),
  }));

  const contextBlock = chunks.length ? buildContextBlock(chunks) : EMPTY_CONTEXT_FALLBACK;
  return { chunks, citations, contextBlock, empty: chunks.length === 0 };
}

export const EMPTY_RETRIEVAL_FALLBACK = EMPTY_CONTEXT_FALLBACK;
