import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const runtime = "edge";

type Params = { params: Promise<{ id: string }> };
const Patch = z.object({
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data, error } = await supabase
    .from("paper_terminology")
    .select(
      "id,user_id,paper_id,version,payload,citations,term_count,pinned,archived,model,prompt_version,created_at,updated_at"
    )
    .eq("id", id)
    .single();
  if (error || !data) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: paper } = await supabase
    .from("papers")
    .select("id,title")
    .eq("id", data.paper_id)
    .single();
  return NextResponse.json({ terminology: data, paper });
}

export async function PATCH(req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let patch: z.infer<typeof Patch>;
  try {
    patch = Patch.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad_request", detail: String(e) }, { status: 400 });
  }
  if (Object.keys(patch).length === 0) {
    return NextResponse.json({ error: "no_fields" }, { status: 400 });
  }

  const { data, error } = await supabase
    .from("paper_terminology")
    .update(patch)
    .eq("id", id)
    .select("id,pinned,archived,updated_at")
    .single();
  if (error || !data) return NextResponse.json({ error: error?.message ?? "not_found" }, { status: 404 });
  return NextResponse.json(data);
}

export async function DELETE(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { error } = await supabase.from("paper_terminology").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
