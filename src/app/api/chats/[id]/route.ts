import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ChatWithMessages } from "@/types/db";

export const runtime = "edge";

type Params = { params: Promise<{ id: string }> };

const Patch = z.object({
  title: z.string().trim().min(1).max(160).nullable().optional(),
  archived: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

export async function GET(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: chat, error } = await supabase.from("chats").select("*").eq("id", id).single();
  if (error || !chat) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: messages } = await supabase
    .from("messages")
    .select("id,role,content,citations,created_at")
    .eq("chat_id", id)
    .order("created_at", { ascending: true });

  let paper: ChatWithMessages["paper"] = null;
  if (chat.paper_id) {
    const { data: p } = await supabase
      .from("papers")
      .select("id,title,storage_path")
      .eq("id", chat.paper_id)
      .single();
    paper = p ?? null;
  }

  const body: ChatWithMessages = {
    ...chat,
    paper,
    messages: messages ?? [],
  };
  return NextResponse.json(body);
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
    .from("chats")
    .update(patch)
    .eq("id", id)
    .select("id,title,archived,pinned,updated_at")
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

  const { error } = await supabase.from("chats").delete().eq("id", id);
  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  return NextResponse.json({ ok: true });
}
