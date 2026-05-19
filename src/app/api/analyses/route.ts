import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { AnalysisHistoryItem, AnalysisKind } from "@/types/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().trim().max(200).optional(),
  kind: z.enum(["summary", "terminology", "comparison"]).optional(),
  paper_id: z.string().uuid().optional(),
  archived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", detail: parsed.error.format() }, { status: 400 });
  }
  const { q = "", kind, paper_id, archived, limit = 30 } = parsed.data;

  const { data, error } = await supabase.rpc("search_analyses", {
    q,
    filter_kind: kind ?? null,
    filter_paper_id: paper_id ?? null,
    include_archived: archived === "true",
    match_count: limit,
  });
  if (error) {
    console.error("[/api/analyses] search_analyses RPC failed:", error);
    return NextResponse.json(
      { error: error.message, hint: "Did you apply migration 0005_analyses.sql? It adds the search_analyses RPC and the three analyses tables." },
      { status: 500 }
    );
  }

  const rows = (data ?? []) as AnalysisHistoryItem[];

  // Hydrate paper titles in one round-trip.
  const paperIds = Array.from(
    new Set(
      rows.flatMap((r) =>
        [r.paper_id, r.paper_a_id, r.paper_b_id].filter((x): x is string => !!x)
      )
    )
  );
  const { data: papers } = paperIds.length
    ? await supabase.from("papers").select("id,title").in("id", paperIds)
    : { data: [] };
  const byId = new Map((papers ?? []).map((p) => [p.id, p]));

  const items: AnalysisHistoryItem[] = rows.map((r) => {
    const ids = [r.paper_id, r.paper_a_id, r.paper_b_id].filter((x): x is string => !!x);
    return {
      ...r,
      papers: ids.map((id) => byId.get(id) ?? { id, title: null }),
    };
  });

  // Counts per kind so the tabs can show badges.
  const counts: Record<AnalysisKind, number> = { summary: 0, terminology: 0, comparison: 0 };
  for (const it of items) counts[it.kind] += 1;

  return NextResponse.json({ items, counts });
}
