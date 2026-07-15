import { NextResponse } from "next/server";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import { createClient } from "@/lib/supabase/server";
import { enqueueIngest } from "@/lib/ingest";
import { IngestRequestSchema, safeParse } from "@/lib/api/schemas";
import { enforceRateLimit } from "@/lib/rate-limit/edge";
import { classifyError, createRequestLogger } from "@/lib/observability/logger";

// The ingestion pipeline is fetch-based end-to-end (Supabase Storage download,
// Anthropic metadata, OpenAI embeddings) and `unpdf` is built for serverless /
// worker runtimes (bundles pdfjs in a worker-compatible shape). It runs in
// the Worker's `nodejs_compat` bundle produced by @opennextjs/cloudflare.
//
// CPU caveat: parsing a long PDF + generating metadata + embedding chunks +
// generating a summary can exceed Cloudflare Workers Free's 30 s CPU cap. For
// large papers, either deploy on the Workers Paid plan (5 min cap) or move
// ingestion to a background queue (Cloudflare Queues / Inngest / Trigger.dev).

export async function POST(req: Request) {
  const log = createRequestLogger({ route: "/api/papers/ingest" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userLog = log.child({ user_id: user.id });

  const rl = await enforceRateLimit({ req, scope: "ingest", userId: user.id });
  if (rl.limited) {
    userLog.warn("ratelimit.blocked", { scope: "ingest" });
    return rl.limited;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    userLog.warn("request.malformed_json");
    return NextResponse.json({ error: "bad_request", detail: "malformed JSON" }, { status: 400 });
  }
  const parsed = safeParse(IngestRequestSchema, payload);
  if (!parsed.ok) {
    userLog.warn("request.validation_failed", { detail: parsed.error });
    return NextResponse.json({ error: "bad_request", detail: parsed.error }, { status: 400 });
  }
  const body = parsed.data;

  const { data: paper } = await supabase
    .from("papers")
    .select("id")
    .eq("id", body.paper_id)
    .single();
  if (!paper) {
    userLog.warn("paper.not_found", { paper_id: body.paper_id });
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }

  // `enqueueIngest` is the swap-in seam for a real queue (Cloudflare Queues /
  // Inngest / Trigger.dev). Today it executes inline with bounded retries; the
  // pipeline writes its own terminal status to `papers.status`, which the
  // client already polls. We pass our request logger so the pipeline-stage
  // logs share the same request_id and user_id.
  const job = enqueueIngest(body.paper_id, {
    logger: userLog.child({ paper_id: body.paper_id }),
  });

  // On Cloudflare, hand the pipeline to the platform's waitUntil so the HTTP
  // response returns immediately instead of blocking the client for the whole
  // parse -> embed -> summarise round-trip (and avoids the request timing out
  // mid-ingest, which used to strand papers in a non-terminal status). The
  // client only checks `res.ok` and tracks progress via `papers.status`, so
  // the early 202 is not a breaking change.
  //
  // NOTE: waitUntil does NOT grant extra CPU — the background work still runs
  // under the same Worker invocation's CPU cap. Very large PDFs still need a
  // real queue (separate invocation). This is the low-cost win, not that fix.
  //
  // Outside Workers (local `next dev`, tests) getCloudflareContext throws; we
  // fall back to awaiting inline and preserve the original response shape.
  let ctx: { waitUntil(p: Promise<unknown>): void } | null = null;
  try {
    ctx = getCloudflareContext().ctx;
  } catch {
    ctx = null;
  }

  if (ctx) {
    // Swallow rejections here: the pipeline has already persisted `failed`
    // status + error to the row, so this catch is only to avoid an unhandled
    // rejection and to leave a correlated log line.
    ctx.waitUntil(
      job.catch((e) => {
        const cls = classifyError(e);
        if (cls.error_type === "conflict") {
          // Double submit lost the claim race; the winning run is healthy.
          userLog.warn("ingest.conflict", { paper_id: body.paper_id });
          return;
        }
        userLog.error("ingest.background_failed", { ...cls, paper_id: body.paper_id });
      })
    );
    return NextResponse.json(
      { ok: true, paper_id: body.paper_id, status: "pending" },
      { status: 202 }
    );
  }

  try {
    const result = await job;
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const cls = classifyError(e);
    if (cls.error_type === "conflict") {
      // Lost the per-paper claim race (double submit): the other run is
      // healthy and will finish; nothing failed.
      userLog.warn("ingest.conflict", { paper_id: body.paper_id });
      return NextResponse.json({ error: "ingest_in_progress" }, { status: 409 });
    }
    userLog.error("ingest.failed", { ...cls, paper_id: body.paper_id });
    return NextResponse.json({ error: "ingest_failed", detail: cls.message }, { status: 500 });
  }
}
