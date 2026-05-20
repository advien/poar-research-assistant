import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

type Params = { params: Promise<{ id: string }> };

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: paper, error } = await supabase
    .from("papers")
    .select("*")
    .eq("id", id)
    .single();
  if (error || !paper) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { count: chunk_count } = await supabase
    .from("chunks")
    .select("id", { count: "exact", head: true })
    .eq("paper_id", id);

  return NextResponse.json({ paper, chunk_count: chunk_count ?? 0 });
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: paper, error: fetchErr } = await supabase
    .from("papers")
    .select("storage_path")
    .eq("id", id)
    .single();
  if (fetchErr || !paper) return NextResponse.json({ error: "not_found" }, { status: 404 });

  if (paper.storage_path) {
    await supabase.storage.from("papers").remove([paper.storage_path]);
  }

  const { error: delErr } = await supabase.from("papers").delete().eq("id", id);
  if (delErr) return NextResponse.json({ error: delErr.message }, { status: 500 });

  return NextResponse.json({ ok: true });
}
