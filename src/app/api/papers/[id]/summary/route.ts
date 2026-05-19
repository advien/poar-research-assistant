import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStructuredSummary } from "@/lib/analyses/generateSummary";
import { enforceRateLimit } from "@/lib/rate-limit/edge";
import { classifyError, createRequestLogger, startTimer } from "@/lib/observability/logger";
import type { SummaryRow } from "@/types/db";

// Edge runtime: structured summary generation uses the AI SDK + Supabase, both
// of which run on Workers. The CPU envelope can be tight on Free; use Paid for
// production-sized papers.
export const runtime = "edge";
export const maxDuration = 120;

type Params = { params: Promise<{ id: string }> };
const SELECT =
  "id,user_id,paper_id,version,payload,citations,title,pinned,archived,model,prompt_version,created_at,updated_at";

/** GET - latest non-archived summary, plus version history (id+version+timestamp). */
export async function GET(_req: Request, { params }: Params) {
  const { id: paperId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: latest, error } = await supabase
    .from("paper_summaries")
    .select(SELECT)
    .eq("paper_id", paperId)
    .eq("archived", false)
    .order("version", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) {
    console.error("[/api/papers/:id/summary] paper_summaries select failed:", error);
    return NextResponse.json(
      { error: error.message, hint: "Did you apply migration 0005_analyses.sql? It creates the paper_summaries table." },
      { status: 500 }
    );
  }

  const { data: versions } = await supabase
    .from("paper_summaries")
    .select("id,version,pinned,archived,created_at")
    .eq("paper_id", paperId)
    .order("version", { ascending: false });

  return NextResponse.json({ summary: latest as SummaryRow | null, versions: versions ?? [] });
}

/** POST - generate (or regenerate) the summary, creating a new version row. */
export async function POST(req: Request, { params }: Params) {
  const { id: paperId } = await params;
  const log = createRequestLogger({ route: "/api/papers/:id/summary", extra: { paper_id: paperId } });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userLog = log.child({ user_id: user.id });

  const rl = await enforceRateLimit({ req, scope: "summary", userId: user.id });
  if (rl.limited) {
    userLog.warn("ratelimit.blocked", { scope: "summary" });
    return rl.limited;
  }

  const { data: paper } = await supabase
    .from("papers")
    .select("id,title")
    .eq("id", paperId)
    .single();
  if (!paper) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const t = startTimer();
  try {
    const generated = await generateStructuredSummary({ supabase, paperId });
    userLog.info("summary.generation.done", {
      model: generated.model,
      citations_count: generated.citations.length,
      latency_ms: t.ms(),
    });

    const { data: maxRow } = await supabase
      .from("paper_summaries")
      .select("version")
      .eq("paper_id", paperId)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version ?? 0) + 1;

    const { data: inserted, error: insErr } = await supabase
      .from("paper_summaries")
      .insert({
        user_id: user.id,
        paper_id: paperId,
        version: nextVersion,
        payload: generated.payload as unknown as never,
        citations: generated.citations as unknown as never,
        title: paper.title ? `Summary of "${paper.title}"` : `Summary v${nextVersion}`,
        model: generated.model,
        prompt_version: "v1",
      })
      .select(SELECT)
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ summary: inserted });
  } catch (e) {
    const cls = classifyError(e);
    userLog.error("summary.generation.failed", { ...cls, latency_ms: t.ms() });
    return NextResponse.json({ error: "generation_failed", detail: cls.message }, { status: 500 });
  }
}
