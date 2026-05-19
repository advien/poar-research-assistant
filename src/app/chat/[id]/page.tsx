import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatWorkspaceLayout } from "@/components/chat/ChatWorkspaceLayout";
import { CrossLibraryChat } from "../_components/CrossLibraryChat";
import type { Citation } from "@/types/db";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function ChatByIdPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: chat } = await supabase
    .from("chats")
    .select("id,paper_id,title")
    .eq("id", id)
    .single();
  if (!chat) notFound();

  // Paper-scoped chats live in the paper view to keep the PDF viewer attached.
  if (chat.paper_id) redirect(`/papers/${chat.paper_id}?chat=${chat.id}`);

  const { data: messages } = await supabase
    .from("messages")
    .select("id,role,content,citations,created_at")
    .eq("chat_id", id)
    .order("created_at", { ascending: true });

  const initialMessages = (messages ?? []).map((m) => ({
    id: m.id,
    role: m.role as "user" | "assistant" | "system",
    content: m.content,
    createdAt: new Date(m.created_at),
    citations: (m.citations ?? []) as Citation[],
  }));

  return (
    <ChatWorkspaceLayout activeChatId={chat.id} newChatHref="/chat">
      <CrossLibraryChat
        chatId={chat.id}
        initialMessages={initialMessages}
        title={chat.title}
        paperId={null}
      />
    </ChatWorkspaceLayout>
  );
}
