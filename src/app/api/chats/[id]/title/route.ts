import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { fallbackTitle, generateChatTitle } from "@/lib/ai/title";

type Params = { params: Promise<{ id: string }> };

/**
 * POST /api/chats/:id/title
 * Generate (or regenerate) a chat title from the first user/assistant exchange.
 */
export async function POST(_req: Request, { params }: Params) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { data: chat } = await supabase
    .from("chats")
    .select("id,paper_id")
    .eq("id", id)
    .single();
  if (!chat) return NextResponse.json({ error: "not_found" }, { status: 404 });

  const { data: msgs } = await supabase
    .from("messages")
    .select("role,content")
    .eq("chat_id", id)
    .order("created_at", { ascending: true })
    .limit(4);

  const firstUser = msgs?.find((m) => m.role === "user");
  const firstAssistant = msgs?.find((m) => m.role === "assistant");
  if (!firstUser) return NextResponse.json({ error: "no_messages" }, { status: 400 });

  let paperTitle: string | null = null;
  if (chat.paper_id) {
    const { data: p } = await supabase
      .from("papers")
      .select("title")
      .eq("id", chat.paper_id)
      .single();
    paperTitle = p?.title ?? null;
  }

  const title = firstAssistant
    ? await generateChatTitle({
        userMessage: firstUser.content,
        assistantMessage: firstAssistant.content,
        paperTitle,
      })
    : fallbackTitle(firstUser.content);

  await supabase.from("chats").update({ title }).eq("id", id);
  return NextResponse.json({ title });
}
