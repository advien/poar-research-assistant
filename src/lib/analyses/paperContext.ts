import type { SupabaseDbClient } from "@/lib/supabase/server";
import type { Citation } from "@/types/db";

export type ChunkRecord = {
  id: string;
  paper_id: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  section: string | null;
  content: string;
};

export type PaperContext = {
  paper: { id: string; title: string | null; authors: string[]; year: number | null };
  chunks: ChunkRecord[];
  citations: Citation[];     // 1-indexed registry mirroring chunks
  prompt_block: string;      // ready to drop into a Claude prompt
};

const PAGE_LABEL = (start: number | null, end: number | null) =>
  start && end && start !== end ? `pp.${start}-${end}` : start ? `p.${start}` : "p.?";

/**
 * Load all chunks for a paper, build a numbered context block + a 1-indexed
 * Citation[] registry. Truncates to `maxChars` characters across chunk content,
 * preserving early/middle/late sections proportionally.
 */
export async function loadPaperContext(args: {
  supabase: SupabaseDbClient;
  paperId: string;
  maxChars?: number;
  prefix?: string; // chunk label prefix, e.g. 'A' for compare-mode
}): Promise<PaperContext> {
  const maxChars = args.maxChars ?? 60_000;
  const prefix = args.prefix ?? "";

  const { data: paper, error: paperErr } = await args.supabase
    .from("papers")
    .select("id,title,authors,year")
    .eq("id", args.paperId)
    .single();
  if (paperErr || !paper) throw new Error(`paper not found: ${args.paperId}`);

  const { data: chunkRows, error: chunksErr } = await args.supabase
    .from("chunks")
    .select("id,paper_id,chunk_index,page_start,page_end,section,content")
    .eq("paper_id", args.paperId)
    .order("chunk_index", { ascending: true });
  if (chunksErr) throw new Error(`chunks query failed: ${chunksErr.message}`);

  const chunks = (chunkRows ?? []) as ChunkRecord[];
  if (chunks.length === 0) {
    return {
      paper,
      chunks: [],
      citations: [],
      prompt_block: "(no extracted content available for this paper)",
    };
  }

  // Greedy budget: keep all chunks if total fits; otherwise sample evenly.
  const totalChars = chunks.reduce((n, c) => n + c.content.length, 0);
  let kept = chunks;
  if (totalChars > maxChars) {
    const stride = Math.ceil(totalChars / maxChars);
    kept = chunks.filter((_, i) => i % stride === 0);
  }

  const citations: Citation[] = kept.map((c, i) => ({
    n: i + 1,
    chunk_id: c.id,
    paper_id: c.paper_id,
    page_start: c.page_start,
    page_end: c.page_end,
    snippet: c.content.slice(0, 240),
  }));

  const prompt_block = kept
    .map((c, i) => {
      const tag = `[${prefix}${i + 1}]`;
      const where = `${PAGE_LABEL(c.page_start, c.page_end)}${c.section ? `, ${c.section}` : ""}`;
      return `${tag} (${where})\n${c.content}`;
    })
    .join("\n\n---\n\n");

  return { paper, chunks: kept, citations, prompt_block };
}

/**
 * Resolve a list of 1-indexed citation references emitted by the model into
 * the actual Citation[] entries for storage/UI consumption.
 *
 * Silently drops out-of-range numbers (Claude occasionally hallucinates them).
 */
export function resolveCitationRefs(refs: number[] | undefined, registry: Citation[]): Citation[] {
  if (!refs || refs.length === 0) return [];
  const out: Citation[] = [];
  const seen = new Set<number>();
  for (const r of refs) {
    if (!Number.isInteger(r) || r < 1 || r > registry.length) continue;
    if (seen.has(r)) continue;
    seen.add(r);
    out.push(registry[r - 1]);
  }
  return out;
}
