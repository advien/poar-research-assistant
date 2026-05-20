import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateComparison, orderPaperIds } from "@/lib/analyses/generateComparison";
import { ComparisonRequestSchema, safeParse } from "@/lib/api/schemas";
import { enforceRateLimit } from "@/lib/rate-limit/edge";
import { classifyError, createRequestLogger, startTimer } from "@/lib/observability/logger";

// Comparison generation is the slowest server call in the app (long Claude
// generateObject completion). On Cloudflare Workers Free this can exceed the
// 30 s CPU cap; deploy on the Paid plan (5 min cap) for production.

const SELECT =
  "id,user_id,paper_a_id,paper_b_id,version,payload,citations,similarity_score,stronger_paper,contradiction_count,title,pinned,archived,model,prompt_version,created_at,updated_at";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const paperA = url.searchParams.get("paper_a_id");
  const paperB = url.searchParams.get("paper_b_id");
  const includeArchived = url.searchParams.get("archived") === "true";

  let query = supabase
    .from("paper_comparisons")
    .select(SELECT)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(50);

  if (!includeArchived) query = query.eq("archived", false);

  if (paperA && paperB) {
    const { a_id, b_id } = orderPaperIds(paperA, paperB);
    query = query.eq("paper_a_id", a_id).eq("paper_b_id", b_id);
  } else if (paperA) {
    query = query.or(`paper_a_id.eq.${paperA},paper_b_id.eq.${paperA}`);
  }

  const { data, error } = await query;
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Hydrate paper titles.
  const ids = Array.from(new Set((data ?? []).flatMap((c) => [c.paper_a_id, c.paper_b_id])));
  const { data: papers } = ids.length
    ? await supabase.from("papers").select("id,title,authors,year").in("id", ids)
    : { data: [] };
  const byId = new Map((papers ?? []).map((p) => [p.id, p]));

  return NextResponse.json({
    comparisons: (data ?? []).map((c) => ({
      ...c,
      paper_a: byId.get(c.paper_a_id) ?? null,
      paper_b: byId.get(c.paper_b_id) ?? null,
    })),
  });
}

export async function POST(req: Request) {
  const log = createRequestLogger({ route: "/api/comparisons" });
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  const userLog = log.child({ user_id: user.id });

  // Comparison generation is the slowest server call (Claude generateObject
  // over both papers). Cap at 3 / min by default.
  const rl = await enforceRateLimit({ req, scope: "comparison", userId: user.id });
  if (rl.limited) {
    userLog.warn("ratelimit.blocked", { scope: "comparison" });
    return rl.limited;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", detail: "malformed JSON" }, { status: 400 });
  }
  const parsed = safeParse(ComparisonRequestSchema, payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: "bad_request", detail: parsed.error }, { status: 400 });
  }
  const body = parsed.data;
  if (body.paper_a_id === body.paper_b_id) {
    return NextResponse.json({ error: "same_paper" }, { status: 400 });
  }

  const { a_id, b_id } = orderPaperIds(body.paper_a_id, body.paper_b_id);

  // Verify ownership of both papers.
  const { data: papers } = await supabase
    .from("papers")
    .select("id,title,status")
    .in("id", [a_id, b_id]);
  if (!papers || papers.length !== 2) {
    return NextResponse.json({ error: "not_found" }, { status: 404 });
  }
  if (papers.some((p) => p.status !== "ready")) {
    return NextResponse.json(
      { error: "papers_not_ready", detail: "both papers must be fully ingested" },
      { status: 400 }
    );
  }

  const t = startTimer();
  try {
    const generated = await generateComparison({
      supabase,
      paperAId: a_id,
      paperBId: b_id,
    });
    userLog.info("comparison.generation.done", {
      model: generated.model,
      paper_a_id: a_id,
      paper_b_id: b_id,
      similarity_score: generated.payload.similarity_score,
      contradiction_count: generated.payload.contradictions.length,
      citations_count: generated.citations.length,
      latency_ms: t.ms(),
    });

    const { data: maxRow } = await supabase
      .from("paper_comparisons")
      .select("version")
      .eq("paper_a_id", a_id)
      .eq("paper_b_id", b_id)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle();
    const nextVersion = (maxRow?.version ?? 0) + 1;

    const titleA = papers.find((p) => p.id === a_id)?.title ?? "Paper A";
    const titleB = papers.find((p) => p.id === b_id)?.title ?? "Paper B";

    const { data: inserted, error: insErr } = await supabase
      .from("paper_comparisons")
      .insert({
        user_id: user.id,
        paper_a_id: a_id,
        paper_b_id: b_id,
        version: nextVersion,
        payload: generated.payload as unknown as never,
        citations: generated.citations as unknown as never,
        similarity_score: generated.payload.similarity_score,
        stronger_paper: generated.payload.stronger_paper,
        contradiction_count: generated.payload.contradictions.length,
        title: `${truncate(titleA, 40)} vs ${truncate(titleB, 40)}`,
        model: generated.model,
        prompt_version: "v1",
      })
      .select(SELECT)
      .single();
    if (insErr) return NextResponse.json({ error: insErr.message }, { status: 500 });

    return NextResponse.json({ comparison: inserted });
  } catch (e) {
    const cls = classifyError(e);
    userLog.error("comparison.generation.failed", { ...cls, latency_ms: t.ms() });
    return NextResponse.json({ error: "generation_failed", detail: cls.message }, { status: 500 });
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}
