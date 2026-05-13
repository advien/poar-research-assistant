import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { generateStructuredSummary } from "@/lib/analyses/generateSummary";
import type { SummaryRow } from "@/types/db";

export const runtime = "nodejs";
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
export async function POST(_req: Request, { params }: Params) {
  const { id: paperId } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Verify ownership via RLS-aware client.
  const { data: paper } = await supabase
    .from("papers")
    .select("id,title")
    .eq("id", paperId)
    .single();
  if (!paper) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const generated = await generateStructuredSummary({ supabase, paperId });

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
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "generation_failed", detail: message }, { status: 500 });
  }
}
