import { NextResponse } from "next/server";
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

  try {
    // `enqueueIngest` is the swap-in seam for a real queue (Cloudflare Queues
    // / Inngest / Trigger.dev). Today it executes inline with bounded retries;
    // tomorrow it can post to a queue and return immediately. The route shape
    // does not change in either case. We pass our request logger so the
    // pipeline-stage logs share the same request_id and user_id.
    const result = await enqueueIngest(body.paper_id, {
      logger: userLog.child({ paper_id: body.paper_id }),
    });
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const cls = classifyError(e);
    userLog.error("ingest.failed", { ...cls, paper_id: body.paper_id });
    return NextResponse.json({ error: "ingest_failed", detail: cls.message }, { status: 500 });
  }
}
