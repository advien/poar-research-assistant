import { describe, expect, it, vi } from "vitest";
import { retrieveContext, EMPTY_RETRIEVAL_FALLBACK } from "@/lib/rag/retrieve";
import type { SupabaseDbClient } from "@/lib/supabase/server";
import type { MatchedChunk } from "@/lib/rag/retrieve";

/**
 * The retriever is the most important code path in the whole product. We can't
 * (and don't want to) hit a real Supabase + pgvector for unit tests, so we use
 * a fake supabase that returns scripted match_chunks results.
 *
 * These tests cover:
 *  - happy path: chunks come back, citations are 1-indexed, contextBlock is built
 *  - retrieval fallback: empty top-k -> a clearly-marked placeholder + empty=true
 *  - retrieval failure: rpc returns an error -> we throw with a clear message
 *  - per-paper scoping: filter_paper_id is forwarded
 *  - integration-style RAG: an "expected" chunk for "What dataset was used?"
 *    must appear in the resolved citations registry
 */

const sampleChunks: MatchedChunk[] = [
  {
    id: "chunk-1",
    paper_id: "paper-1",
    chunk_index: 0,
    page_start: 1,
    page_end: 1,
    section: "abstract",
    content: "We trained a controller for transtibial powered prostheses.",
    similarity: 0.92,
  },
  {
    id: "chunk-2",
    paper_id: "paper-1",
    chunk_index: 4,
    page_start: 4,
    page_end: 5,
    section: "methods",
    content: "We used the Ninapro DB-2 sEMG dataset (40 subjects, 49 movements).",
    similarity: 0.89,
  },
  {
    id: "chunk-3",
    paper_id: "paper-1",
    chunk_index: 7,
    page_start: 7,
    page_end: 7,
    section: "results",
    content: "Classification accuracy reached 87.3% on held-out subjects.",
    similarity: 0.81,
  },
];

function fakeSupabase(opts: {
  data?: MatchedChunk[];
  error?: { message: string };
  capture?: { rpcName?: string; rpcArgs?: unknown };
}) {
  const rpc = vi.fn(async (name: string, args: unknown) => {
    if (opts.capture) {
      opts.capture.rpcName = name;
      opts.capture.rpcArgs = args;
    }
    if (opts.error) return { data: null, error: opts.error };
    return { data: opts.data ?? [], error: null };
  });
  return { rpc } as unknown as SupabaseDbClient & { rpc: typeof rpc };
}

const fakeEmbedder = vi.fn(async (_query: string) => Array.from({ length: 1536 }, () => 0));

describe("retrieveContext - happy path", () => {
  it("returns 1-indexed Citations matching every retrieved chunk", async () => {
    const supabase = fakeSupabase({ data: sampleChunks });
    const out = await retrieveContext({
      supabase,
      query: "Which dataset was used?",
      embedder: fakeEmbedder,
    });
    expect(out.empty).toBe(false);
    expect(out.chunks).toHaveLength(3);
    expect(out.citations).toHaveLength(3);
    expect(out.citations.map((c) => c.n)).toEqual([1, 2, 3]);
    expect(out.citations[0].chunk_id).toBe("chunk-1");
    expect(out.citations[1].snippet).toContain("Ninapro");
  });

  it("builds a numbered Claude-ready context block including chunk content", async () => {
    const supabase = fakeSupabase({ data: sampleChunks });
    const out = await retrieveContext({
      supabase,
      query: "Which dataset was used?",
      embedder: fakeEmbedder,
    });
    expect(out.contextBlock).toMatch(/^\[1\]/);
    expect(out.contextBlock).toContain("[2]");
    expect(out.contextBlock).toContain("Ninapro DB-2");
    expect(out.contextBlock).toContain("p.1");
    expect(out.contextBlock).toContain("pp.4-5");
  });
});

describe("retrieveContext - fallback / error handling", () => {
  it("returns the EMPTY_RETRIEVAL_FALLBACK placeholder when zero chunks come back", async () => {
    const supabase = fakeSupabase({ data: [] });
    const out = await retrieveContext({
      supabase,
      query: "irrelevant query",
      embedder: fakeEmbedder,
    });
    expect(out.empty).toBe(true);
    expect(out.chunks).toEqual([]);
    expect(out.citations).toEqual([]);
    expect(out.contextBlock).toBe(EMPTY_RETRIEVAL_FALLBACK);
  });

  it("handles a null payload from match_chunks (RLS edge case) the same as empty", async () => {
    const supabase = fakeSupabase({ data: undefined });
    const out = await retrieveContext({
      supabase,
      query: "x",
      embedder: fakeEmbedder,
    });
    expect(out.empty).toBe(true);
    expect(out.contextBlock).toBe(EMPTY_RETRIEVAL_FALLBACK);
  });

  it("throws a clear error when the RPC fails", async () => {
    const supabase = fakeSupabase({ error: { message: "permission denied" } });
    await expect(
      retrieveContext({ supabase, query: "x", embedder: fakeEmbedder })
    ).rejects.toThrow(/permission denied/);
  });
});

describe("retrieveContext - parameter forwarding", () => {
  it("forwards filter_paper_id when provided (per-paper chat)", async () => {
    const capture: { rpcName?: string; rpcArgs?: unknown } = {};
    const supabase = fakeSupabase({ data: sampleChunks, capture });
    await retrieveContext({
      supabase,
      query: "x",
      paperId: "paper-1",
      embedder: fakeEmbedder,
    });
    expect(capture.rpcName).toBe("match_chunks");
    const args = capture.rpcArgs as Record<string, unknown>;
    expect(args.filter_paper_id).toBe("paper-1");
    expect(args.match_count).toBe(8);
  });

  it("widens k when paperId is not provided (cross-library chat)", async () => {
    const capture: { rpcName?: string; rpcArgs?: unknown } = {};
    const supabase = fakeSupabase({ data: sampleChunks, capture });
    await retrieveContext({ supabase, query: "x", embedder: fakeEmbedder });
    const args = capture.rpcArgs as Record<string, unknown>;
    expect(args.match_count).toBe(12);
    expect(args.filter_paper_id).toBeNull();
  });
});

// =============================================================================
// Integration-style RAG test
// =============================================================================
describe("RAG integration (mocked retriever)", () => {
  /**
   * The "Which dataset was used?" question is the canonical RAG smoke test.
   * Set up a tiny library where the relevant chunk explicitly mentions the
   * dataset, and assert the retriever surfaces that chunk in top-k AND that
   * the resolved Citation registry exposes its content to the LLM prompt.
   */
  it("Q: 'What dataset was used?' -> retriever surfaces the dataset chunk in top-k", async () => {
    const library: MatchedChunk[] = [
      {
        id: "ds-chunk",
        paper_id: "paper-A",
        chunk_index: 4,
        page_start: 4,
        page_end: 5,
        section: "methods",
        content: "Dataset: Ninapro DB-2 sEMG recordings of 40 intact-limb subjects.",
        similarity: 0.91,
      },
      {
        id: "noise-1",
        paper_id: "paper-A",
        chunk_index: 1,
        page_start: 1,
        page_end: 1,
        section: "abstract",
        content: "This paper studies myoelectric prosthesis control.",
        similarity: 0.6,
      },
    ];

    const supabase = fakeSupabase({ data: library });
    const out = await retrieveContext({
      supabase,
      query: "What dataset was used?",
      paperId: "paper-A",
      embedder: fakeEmbedder,
    });

    // Top-k contains the dataset chunk.
    expect(out.empty).toBe(false);
    expect(out.chunks[0].id).toBe("ds-chunk");

    // Citation registry exposes the chunk to the UI.
    const ds = out.citations.find((c) => c.chunk_id === "ds-chunk");
    expect(ds).toBeDefined();
    expect(ds?.snippet).toContain("Ninapro");

    // Context block includes the dataset content (so the LLM can ground on it).
    expect(out.contextBlock).toContain("Ninapro DB-2");
    expect(out.contextBlock).toMatch(/\[1\]/);
  });
});
