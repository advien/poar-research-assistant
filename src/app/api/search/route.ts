import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { embedQuery } from "@/lib/ai/openai";

const Body = z.object({
  q: z.string().min(1).max(500),
  paper_id: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

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

  const queryEmbedding = await embedQuery(body.q);

  const { data, error } = await supabase.rpc("hybrid_search", {
    query_text: body.q,
    query_embedding: queryEmbedding,
    match_count: body.limit ?? 12,
    filter_paper_id: body.paper_id ?? null,
  });
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  // Dedup: keep best-scoring chunk per (paper_id, page_start) window.
  const seen = new Set<string>();
  const deduped = (data ?? []).filter((c) => {
    const key = `${c.paper_id}:${c.page_start ?? "?"}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  // Hydrate with paper titles for display.
  const paperIds = Array.from(new Set(deduped.map((c) => c.paper_id)));
  const { data: papers } = await supabase
    .from("papers")
    .select("id,title,authors,year")
    .in("id", paperIds);
  const byId = new Map(papers?.map((p) => [p.id, p]));

  return NextResponse.json({
    results: deduped.map((c) => ({
      ...c,
      paper: byId.get(c.paper_id) ?? null,
    })),
  });
}
