import { createAdminClient } from "@/lib/supabase/admin";
import { parsePdf } from "./parsePdf";
import { chunkPages } from "./chunk";
import { embedAll } from "./embed";
import { extractMetadata } from "./extractMetadata";
import { summarisePaper } from "./summary";

export type IngestResult = {
  paper_id: string;
  chunks: number;
  pages: number;
};

/**
 * Ingest a single paper end-to-end. Uses the service-role client because the
 * caller has already verified ownership in the API route.
 *
 * Status transitions: pending -> parsing -> embedding -> ready (or failed).
 */
export async function ingestPaper(paperId: string): Promise<IngestResult> {
  const admin = createAdminClient();

  const { data: paper, error: fetchErr } = await admin
    .from("papers")
    .select("id, user_id, storage_path")
    .eq("id", paperId)
    .single();

  if (fetchErr || !paper) {
    throw new Error(`paper not found: ${paperId}`);
  }

  try {
    await admin
      .from("papers")
      .update({ status: "parsing", error: null })
      .eq("id", paperId);

    // 1. Download the PDF from Storage.
    const { data: blob, error: dlErr } = await admin.storage
      .from("papers")
      .download(paper.storage_path);
    if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
    const buf = new Uint8Array(await blob.arrayBuffer());

    // 2. Parse PDF.
    const { pages, totalPages } = await parsePdf(buf);
    if (totalPages === 0 || pages.every((p) => !p.text.trim())) {
      throw new Error("no extractable text (scanned PDF? OCR not supported in MVP)");
    }

    // 3. Metadata via Claude.
    const meta = await extractMetadata(pages);

    await admin
      .from("papers")
      .update({
        status: "embedding",
        page_count: totalPages,
        title: meta.title ?? undefined,
        authors: meta.authors,
        journal: meta.journal,
        year: meta.year,
        doi: meta.doi,
        abstract: meta.abstract,
        tags: meta.tags,
      })
      .eq("id", paperId);

    // 4. Chunk + embed.
    const chunks = chunkPages(pages);
    if (chunks.length === 0) throw new Error("no chunks produced");

    const vectors = await embedAll(chunks.map((c) => c.content));

    const rows = chunks.map((c, i) => ({
      paper_id: paperId,
      user_id: paper.user_id,
      chunk_index: c.index,
      page_start: c.page_start,
      page_end: c.page_end,
      section: c.section,
      content: c.content,
      tokens: c.tokens,
      embedding: vectors[i],
    }));

    // Insert in batches to keep payloads reasonable.
    const BATCH = 100;
    for (let i = 0; i < rows.length; i += BATCH) {
      const slice = rows.slice(i, i + BATCH);
      const { error: insErr } = await admin.from("chunks").insert(slice);
      if (insErr) throw new Error(`chunk insert failed: ${insErr.message}`);
    }

    // 5. Summary.
    const summary = await summarisePaper(pages, meta);

    await admin
      .from("papers")
      .update({ status: "ready", summary })
      .eq("id", paperId);

    return { paper_id: paperId, chunks: chunks.length, pages: totalPages };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await admin
      .from("papers")
      .update({ status: "failed", error: message })
      .eq("id", paperId);
    throw e;
  }
}
