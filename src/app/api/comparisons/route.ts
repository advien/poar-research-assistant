import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { generateComparison, orderPaperIds } from "@/lib/analyses/generateComparison";

export const runtime = "nodejs";
export const maxDuration = 240;

const SELECT =
  "id,user_id,paper_a_id,paper_b_id,version,payload,citations,similarity_score,stronger_paper,contradiction_count,title,pinned,archived,model,prompt_version,created_at,updated_at";

const Body = z.object({
  paper_a_id: z.string().uuid(),
  paper_b_id: z.string().uuid(),
});

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
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad_request", detail: String(e) }, { status: 400 });
  }
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

  try {
    const generated = await generateComparison({
      supabase,
      paperAId: a_id,
      paperBId: b_id,
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
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "generation_failed", detail: message }, { status: 500 });
  }
}

function truncate(s: string, n: number) {
  return s.length > n ? `${s.slice(0, n - 1)}...` : s;
}
