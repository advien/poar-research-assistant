import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { ingestPaper } from "@/lib/ingest";

export const runtime = "nodejs";
export const maxDuration = 300; // 5 minutes for slow PDFs / metadata calls

const Body = z.object({ paper_id: z.string().uuid() });

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

  // Verify the paper belongs to the caller (RLS will also enforce this on read).
  const { data: paper } = await supabase
    .from("papers")
    .select("id")
    .eq("id", body.paper_id)
    .single();
  if (!paper) return NextResponse.json({ error: "not_found" }, { status: 404 });

  try {
    const result = await ingestPaper(body.paper_id);
    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: "ingest_failed", detail: message }, { status: 500 });
  }
}
