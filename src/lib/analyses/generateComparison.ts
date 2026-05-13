import { generateObject } from "ai";
import type { SupabaseDbClient } from "@/lib/supabase/server";
import { chatModel, CHAT_MODEL } from "@/lib/ai/anthropic";
import { COMPARE_SYSTEM } from "./prompts";
import { PaperComparison, type PaperComparisonT } from "./schemas";
import { loadPaperContext } from "./paperContext";
import type { Citation, ComparisonRow } from "@/types/db";

export type ComparisonCitation = ComparisonRow["citations"][number];

export type GeneratedComparison = {
  payload: PaperComparisonT;
  citations: ComparisonCitation[];
  model: string;
};

export async function generateComparison(args: {
  supabase: SupabaseDbClient;
  paperAId: string;
  paperBId: string;
}): Promise<GeneratedComparison> {
  const [a, b] = await Promise.all([
    loadPaperContext({ supabase: args.supabase, paperId: args.paperAId, prefix: "A", maxChars: 35_000 }),
    loadPaperContext({ supabase: args.supabase, paperId: args.paperBId, prefix: "B", maxChars: 35_000 }),
  ]);

  if (a.chunks.length === 0 || b.chunks.length === 0) {
    throw new Error("one of the papers has no extracted chunks - run ingestion first");
  }

  const { object } = await generateObject({
    model: chatModel,
    schema: PaperComparison,
    system: COMPARE_SYSTEM,
    prompt: `Paper A: "${a.paper.title ?? "(untitled)"}" by ${(a.paper.authors ?? []).join(", ")}${a.paper.year ? ` (${a.paper.year})` : ""}
Paper B: "${b.paper.title ?? "(untitled)"}" by ${(b.paper.authors ?? []).join(", ")}${b.paper.year ? ` (${b.paper.year})` : ""}

# Paper A chunks

${a.prompt_block}

# Paper B chunks

${b.prompt_block}

Now produce the structured comparison JSON.`,
    temperature: 0.2,
    // 8 paired fields + contradictions + assessment. ~6000 tokens typical;
    // give comfortable headroom.
    maxTokens: 12000,
  });

  // Build the prefixed citation registry the UI consumes.
  const citations: ComparisonCitation[] = [
    ...a.citations.map((c) => toComparisonCitation("A", c)),
    ...b.citations.map((c) => toComparisonCitation("B", c)),
  ];

  return { payload: object, citations, model: CHAT_MODEL };
}

function toComparisonCitation(prefix: "A" | "B", c: Citation): ComparisonCitation {
  return {
    ref: `${prefix}${c.n}`,
    chunk_id: c.chunk_id,
    paper_id: c.paper_id,
    page_start: c.page_start,
    page_end: c.page_end,
    snippet: c.snippet,
  };
}

/** Normalise (a,b) by paper id ordering so the comparisons table's ordered-pair
 *  constraint is always satisfied and the unique key is stable. */
export function orderPaperIds(a: string, b: string): { a_id: string; b_id: string; swapped: boolean } {
  return a < b ? { a_id: a, b_id: b, swapped: false } : { a_id: b, b_id: a, swapped: true };
}
