import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ChatWorkspaceLayout } from "@/components/chat/ChatWorkspaceLayout";
import { CrossLibraryChat } from "./_components/CrossLibraryChat";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function CrossLibraryChatPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  return (
    <ChatWorkspaceLayout activeChatId={null} newChatHref="/chat">
      <CrossLibraryChat
        chatId={null}
        initialMessages={[]}
        title={null}
        paperId={null}
      />
    </ChatWorkspaceLayout>
  );
}
