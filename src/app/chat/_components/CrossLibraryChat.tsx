"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ChatPanel, type InitialChatMessage } from "@/app/papers/[id]/_components/ChatPanel";
import type { Citation } from "@/types/db";

type Props = {
  chatId: string | null;
  initialMessages: InitialChatMessage[];
  title: string | null;
  paperId: string | null;
};

export function CrossLibraryChat({ chatId, initialMessages, title, paperId }: Props) {
  const router = useRouter();
  const [displayTitle, setDisplayTitle] = useState<string | null>(title);

  return (
    <ChatPanel
      paperId={paperId}
      chatId={chatId}
      initialMessages={initialMessages}
      emptyHelp={
        chatId
          ? "Continue this conversation. Cited papers and pages remain clickable."
          : "Ask anything about your library. Answers cite specific papers and pages; click a citation to open the source paper."
      }
      onCitationClick={(c: Citation) => {
        if (c.paper_id) router.push(`/papers/${c.paper_id}?from=chat&chat=${chatId ?? ""}`);
      }}
      onChatCreated={(newId) => {
        // Move from /chat -> /chat/<id> without re-fetching the (still-streaming) page.
        router.replace(`/chat/${newId}`);
      }}
      onTitleGenerated={(_id, t) => {
        setDisplayTitle(t);
        router.refresh();
      }}
      topBanner={
        displayTitle ? (
          <header className="border-b px-5 py-2 bg-background">
            <h2 className="text-sm font-medium leading-tight">{displayTitle}</h2>
          </header>
        ) : null
      }
    />
  );
}
