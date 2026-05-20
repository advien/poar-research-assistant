import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { PaperWorkspace } from "./_components/PaperWorkspace";
import type { Citation, ChatListItem } from "@/types/db";
import type { InitialChatMessage as IM } from "./_components/ChatPanel";

export const dynamic = "force-dynamic";

type SearchParams = { chat?: string; new?: string };

export default async function PaperPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<SearchParams>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const requestedChat = sp.chat ?? null;
  const requestNew = sp.new === "1";

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: paper } = await supabase
    .from("papers")
    .select("*")
    .eq("id", id)
    .single();
  if (!paper) notFound();

  const { data: signed } = await supabase.storage
    .from("papers")
    .createSignedUrl(paper.storage_path, 60 * 60);

  // Build the per-paper chat picker (most recent 25, no archived).
  const { data: paperChats } = await supabase
    .from("chats")
    .select(
      "id,paper_id,title,archived,pinned,message_count,last_message_at,created_at,updated_at"
    )
    .eq("paper_id", id)
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(25);

  // Determine which chat to load.
  let activeChatId: string | null = null;
  if (!requestNew) {
    if (requestedChat && paperChats?.some((c) => c.id === requestedChat)) {
      activeChatId = requestedChat;
    } else if (paperChats && paperChats.length > 0) {
      activeChatId = paperChats[0].id;
    }
  }

  let initialMessages: IM[] = [];
  if (activeChatId) {
    const { data: msgs } = await supabase
      .from("messages")
      .select("id,role,content,citations,created_at")
      .eq("chat_id", activeChatId)
      .order("created_at", { ascending: true });
    initialMessages = (msgs ?? []).map((m) => ({
      id: m.id,
      role: m.role as "user" | "assistant" | "system",
      content: m.content,
      createdAt: new Date(m.created_at),
      citations: (m.citations ?? []) as Citation[],
    }));
  }

  return (
    <div className="mx-auto max-w-[1600px] h-[calc(100vh-3.5rem)] flex flex-col">
      <header className="border-b px-6 py-3 space-y-1">
        <div className="flex items-center justify-between gap-4">
          <h1 className="text-lg font-semibold leading-tight truncate">
            {paper.title || "Untitled paper"}
          </h1>
          <div className="flex items-center gap-1 shrink-0">
            {(paper.tags ?? []).slice(0, 6).map((t: string) => (
              <Badge key={t} variant="secondary">
                {t}
              </Badge>
            ))}
          </div>
        </div>
        <p className="text-xs text-muted-foreground">
          {(paper.authors ?? []).join(", ") || "Unknown authors"}
          {paper.year ? ` (${paper.year})` : ""}
          {paper.journal ? ` - ${paper.journal}` : ""}
          {paper.doi ? ` - doi:${paper.doi}` : ""}
        </p>
      </header>
      <PaperWorkspace
        paperId={paper.id}
        pdfUrl={signed?.signedUrl ?? null}
        summary={paper.summary}
        status={paper.status}
        error={paper.error}
        chatId={activeChatId}
        initialMessages={initialMessages}
        chatHistory={(paperChats ?? []) as ChatListItem[]}
      />
    </div>
  );
}
