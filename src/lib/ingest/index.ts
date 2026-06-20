import { createAdminClient } from "@/lib/supabase/admin";
import { parsePdf } from "./parsePdf";
import { chunkPages } from "./chunk";
import { embedAll } from "./embed";
import { extractMetadata } from "./extractMetadata";
import { summarisePaper } from "./summary";
import {
  classifyError,
  createLogger,
  startTimer,
  type Logger,
} from "@/lib/observability/logger";

export type IngestResult = {
  paper_id: string;
  chunks: number;
  pages: number;
};

export type IngestStatus =
  | "pending"
  | "parsing"
  | "embedding"
  | "summarizing"
  | "ready"
  | "failed"
  | "retrying";

export type IngestOptions = {
  /** Number of attempts before declaring a hard failure. Default: 1 (no retry). */
  maxAttempts?: number;
  /** Caller-supplied logger (for sharing request_id across pipeline stages). */
  logger?: Logger;
};

/**
 * Ingest a single paper end-to-end. Uses the service-role client because the
 * caller has already verified ownership in the API route.
 *
 * Status transitions:
 *   pending -> parsing -> embedding -> summarizing -> ready
 *                                                  \-> failed
 *                                                  \-> retrying (transient errors only)
 *
 * The pipeline is split into discrete stages; each writes its terminal status
 * to `papers.status` so the UI can surface progress in real time. On a thrown
 * error the row transitions to `failed` with the classified error message; if
 * `maxAttempts > 1` and the failure is transient the function will retry,
 * setting status to `retrying` between attempts.
 */
export async function ingestPaper(
  paperId: string,
  opts: IngestOptions = {}
): Promise<IngestResult> {
  const maxAttempts = Math.max(1, opts.maxAttempts ?? 1);
  const log = (opts.logger ?? createLogger({ component: "ingest" })).child({
    paper_id: paperId,
  });

  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const attemptLog = log.child({ attempt, max_attempts: maxAttempts });
    try {
      return await runIngest(paperId, attemptLog);
    } catch (e) {
      lastErr = e;
      const cls = classifyError(e);
      attemptLog.error("ingest.attempt_failed", cls);
      if (attempt < maxAttempts && isTransient(cls.error_type)) {
        try {
          const admin = createAdminClient();
          await admin
            .from("papers")
            .update({ status: "retrying" satisfies IngestStatus, error: cls.message })
            .eq("id", paperId);
        } catch {
          // ignore status-write failure; the next attempt will re-mark.
        }
        const delayMs = Math.min(15_000, 500 * 2 ** (attempt - 1));
        attemptLog.warn("ingest.retrying", { delay_ms: delayMs });
        await sleep(delayMs);
        continue;
      }
      // Non-transient or out of attempts: write final failed status and bail.
      try {
        const admin = createAdminClient();
        await admin
          .from("papers")
          .update({ status: "failed" satisfies IngestStatus, error: cls.message })
          .eq("id", paperId);
      } catch {
        // ignore status-write failure
      }
      throw e;
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("ingest failed");
}

async function runIngest(paperId: string, log: Logger): Promise<IngestResult> {
  const admin = createAdminClient();
  const totalTimer = startTimer();

  const { data: paper, error: fetchErr } = await admin
    .from("papers")
    .select("id, user_id, storage_path")
    .eq("id", paperId)
    .single();

  if (fetchErr || !paper) {
    throw new Error(`paper not found: ${paperId}`);
  }

  // ---------------------------------------------------------------------------
  // Stage: parsing (status set, progress = 10%)
  // ---------------------------------------------------------------------------
  await setStatus(paperId, "parsing", { ingest_progress_pct: 10, error: null });
  const parseTimer = startTimer();

  const { data: blob, error: dlErr } = await admin.storage
    .from("papers")
    .download(paper.storage_path);
  if (dlErr || !blob) throw new Error(`download failed: ${dlErr?.message}`);
  const buf = new Uint8Array(await blob.arrayBuffer());

  const { pages, totalPages } = await parsePdf(buf);
  if (totalPages === 0 || pages.every((p) => !p.text.trim())) {
    throw new Error("no extractable text (scanned PDF? OCR not supported in MVP)");
  }
  log.info("ingest.parse.done", { pages: totalPages, latency_ms: parseTimer.ms() });

  // ---------------------------------------------------------------------------
  // Metadata extraction (progress = 30%)
  // ---------------------------------------------------------------------------
  const metaTimer = startTimer();
  const meta = await extractMetadata(pages);
  log.info("ingest.metadata.done", {
    has_title: !!meta.title,
    authors: meta.authors?.length ?? 0,
    tags: meta.tags?.length ?? 0,
    latency_ms: metaTimer.ms(),
  });

  await admin
    .from("papers")
    .update({
      status: "embedding" satisfies IngestStatus,
      ingest_progress_pct: 40,
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

  // ---------------------------------------------------------------------------
  // Stage: embedding (progress 40 -> 80)
  // ---------------------------------------------------------------------------
  const chunkTimer = startTimer();
  const chunks = chunkPages(pages);
  if (chunks.length === 0) throw new Error("no chunks produced");
  log.info("ingest.chunk.done", {
    chunks: chunks.length,
    avg_tokens: Math.round(chunks.reduce((s, c) => s + c.tokens, 0) / chunks.length),
    latency_ms: chunkTimer.ms(),
  });

  const embedTimer = startTimer();
  const vectors = await embedAll(chunks.map((c) => c.content));
  log.info("ingest.embed.done", {
    vectors: vectors.length,
    dim: vectors[0]?.length ?? 0,
    latency_ms: embedTimer.ms(),
  });

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

  const BATCH = 100;
  for (let i = 0; i < rows.length; i += BATCH) {
    const slice = rows.slice(i, i + BATCH);
    const { error: insErr } = await admin.from("chunks").insert(slice);
    if (insErr) throw new Error(`chunk insert failed: ${insErr.message}`);
  }

  // ---------------------------------------------------------------------------
  // Stage: summarizing (progress = 90%)
  // ---------------------------------------------------------------------------
  await setStatus(paperId, "summarizing", { ingest_progress_pct: 90 });
  const summaryTimer = startTimer();
  const summary = await summarisePaper(pages, meta);
  log.info("ingest.summary.done", { latency_ms: summaryTimer.ms() });

  // Trigger sets ingest_finished_at and clamps ingest_progress_pct to 100.
  await admin
    .from("papers")
    .update({ status: "ready" satisfies IngestStatus, summary })
    .eq("id", paperId);

  log.info("ingest.done", {
    chunks: chunks.length,
    pages: totalPages,
    total_latency_ms: totalTimer.ms(),
  });
  return { paper_id: paperId, chunks: chunks.length, pages: totalPages };
}

/**
 * Single-row status write used by every stage transition. Centralised so the
 * pipeline never forgets to clear `error` when moving forward, and so future
 * concerns (audit log, realtime nudge, telemetry) only need a hook here.
 */
async function setStatus(
  paperId: string,
  status: IngestStatus,
  patch: Partial<{ ingest_progress_pct: number; error: string | null }> = {}
): Promise<void> {
  const admin = createAdminClient();
  await admin
    .from("papers")
    .update({ status, ...patch })
    .eq("id", paperId);
}

// =============================================================================
// Job abstraction (background-style enqueue)
// =============================================================================

export type IngestJob = {
  paperId: string;
  attempts: number;
  status: IngestStatus;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  progressPct: number;
};

/**
 * Enqueue an ingestion job. The current backend is a fire-and-forget call
 * that returns a Promise that resolves when the worker finishes; the caller
 * (route handler) is expected to either:
 *   - `await` it inline (current behaviour, simplest), or
 *   - hand it to the runtime's `waitUntil()` so the response can be sent
 *     immediately and ingestion continues in the background.
 *
 * This shape lets us swap the implementation for Cloudflare Queues / Inngest
 * / a Postgres-backed worker without changing route handlers: the route
 * always calls `enqueueIngest(paperId, opts)` and awaits / waitUntil's the
 * returned promise.
 */
export function enqueueIngest(
  paperId: string,
  opts: IngestOptions = {}
): Promise<IngestResult> {
  // Default: 2 attempts on transient errors. Production swap-in for
  // Cloudflare Queues would post a message here instead.
  return ingestPaper(paperId, { maxAttempts: opts.maxAttempts ?? 2, ...opts });
}

/**
 * Read the current job state for a paper. Returns null if the row doesn't
 * exist (or RLS hides it). The route layer should still authorise the read.
 */
export async function getIngestJob(paperId: string): Promise<IngestJob | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("papers")
    .select(
      "id,status,error,ingest_attempts,ingest_started_at,ingest_finished_at,ingest_progress_pct"
    )
    .eq("id", paperId)
    .maybeSingle();
  if (!data) return null;
  return {
    paperId: data.id,
    status: data.status as IngestStatus,
    error: data.error,
    attempts: data.ingest_attempts,
    startedAt: data.ingest_started_at,
    finishedAt: data.ingest_finished_at,
    progressPct: data.ingest_progress_pct,
  };
}

/**
 * Transient errors are worth a retry. Non-transient errors (no extractable
 * text, validation, model schema rejection) will fail again on every retry, so
 * we surface them immediately and let the user fix the input.
 *
 * `network` (transport-layer failures: connection refused/reset, DNS, TLS) is
 * deliberately NOT transient. In practice these come from a persistent cause —
 * exhausted/rotated provider key, billing, an upstream outage — that affects
 * every paper, so retrying just doubles load and cost without ever succeeding.
 * Surface it fast with the real `cause` (see classifyError) and let the
 * operator fix the root cause; a true one-off blip is rare enough to re-upload.
 */
function isTransient(errorType: string): boolean {
  return errorType === "timeout" || errorType === "rate_limit" || errorType === "internal";
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
