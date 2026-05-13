import { generateObject } from "ai";
import type { SupabaseDbClient } from "@/lib/supabase/server";
import { chatModel, CHAT_MODEL } from "@/lib/ai/anthropic";
import { SUMMARY_SYSTEM } from "./prompts";
import { StructuredSummary, type StructuredSummaryT } from "./schemas";
import { loadPaperContext, resolveCitationRefs } from "./paperContext";
import type { Citation } from "@/types/db";

export type GeneratedSummary = {
  payload: StructuredSummaryT;
  citations: Citation[];
  resolved: ResolvedSummary;
  model: string;
};

/** Same shape as StructuredSummaryT but each `citations: number[]` is replaced
 *  with the real Citation[] array - used directly by the UI. */
export type ResolvedSummary = {
  abstract_summary: { text: string; citations: Citation[] };
  key_methodology: { items: string[]; citations: Citation[] };
  main_findings: { items: string[]; citations: Citation[] };
  limitations: { items: string[]; citations: Citation[] };
  clinical_relevance: { text: string; citations: Citation[] };
  po_relevance: { text: string; citations: Citation[] };
  future_directions: { items: string[]; citations: Citation[] };
};

export async function generateStructuredSummary(args: {
  supabase: SupabaseDbClient;
  paperId: string;
}): Promise<GeneratedSummary> {
  const ctx = await loadPaperContext({ supabase: args.supabase, paperId: args.paperId });
  if (ctx.chunks.length === 0) {
    throw new Error("paper has no extracted chunks - run ingestion first");
  }

  const { object } = await generateObject({
    model: chatModel,
    schema: StructuredSummary,
    system: SUMMARY_SYSTEM,
    prompt: `Paper: "${ctx.paper.title ?? "(untitled)"}" by ${(ctx.paper.authors ?? []).join(", ") || "unknown authors"}${ctx.paper.year ? ` (${ctx.paper.year})` : ""}

Context chunks:

${ctx.prompt_block}

Now produce the structured summary JSON.`,
    temperature: 0.2,
    // Headroom for the 7 sections + their citation arrays. Default 4096 is
    // borderline-OK but tight; a verbose paper occasionally truncates.
    maxTokens: 8000,
  });

  const resolved: ResolvedSummary = {
    abstract_summary: {
      text: object.abstract_summary.text,
      citations: resolveCitationRefs(object.abstract_summary.citations, ctx.citations),
    },
    key_methodology: {
      items: object.key_methodology.items,
      citations: resolveCitationRefs(object.key_methodology.citations, ctx.citations),
    },
    main_findings: {
      items: object.main_findings.items,
      citations: resolveCitationRefs(object.main_findings.citations, ctx.citations),
    },
    limitations: {
      items: object.limitations.items,
      citations: resolveCitationRefs(object.limitations.citations, ctx.citations),
    },
    clinical_relevance: {
      text: object.clinical_relevance.text,
      citations: resolveCitationRefs(object.clinical_relevance.citations, ctx.citations),
    },
    po_relevance: {
      text: object.po_relevance.text,
      citations: resolveCitationRefs(object.po_relevance.citations, ctx.citations),
    },
    future_directions: {
      items: object.future_directions.items,
      citations: resolveCitationRefs(object.future_directions.citations, ctx.citations),
    },
  };

  // Persist registry as the canonical citation list. UI re-resolves at read time.
  return { payload: object, citations: ctx.citations, resolved, model: CHAT_MODEL };
}
