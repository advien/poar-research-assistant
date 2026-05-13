"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import dynamic from "next/dynamic";
import { MessageSquare, Sparkles, BookOpen, GitCompare } from "lucide-react";
import Link from "next/link";
import { ChatPanel, type InitialChatMessage } from "./ChatPanel";
import { PaperChatHistory } from "./PaperChatHistory";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { SummaryTab } from "./SummaryTab";
import { TerminologyTab } from "./TerminologyTab";
import type { Citation, ChatListItem, PaperStatus } from "@/types/db";

const PdfViewer = dynamic(() => import("./PdfViewer").then((m) => m.PdfViewer), {
  ssr: false,
  loading: () => (
    <div className="h-full grid place-items-center text-sm text-muted-foreground">
      Loading PDF viewer...
    </div>
  ),
});

type Props = {
  paperId: string;
  pdfUrl: string | null;
  summary: string | null;
  status: PaperStatus;
  error: string | null;
  chatId: string | null;
  initialMessages: InitialChatMessage[];
  chatHistory: ChatListItem[];
};

type TabKey = "chat" | "summary" | "terms";

const VALID_TABS: readonly TabKey[] = ["chat", "summary", "terms"];

export function PaperWorkspace({
  paperId,
  pdfUrl,
  summary,
  status,
  error,
  chatId,
  initialMessages,
  chatHistory,
}: Props) {
  const router = useRouter();
  const sp = useSearchParams();
  const tabParam = sp.get("tab") as TabKey | null;
  const initialTab: TabKey = tabParam && VALID_TABS.includes(tabParam) ? tabParam : "chat";

  const [tab, setTab] = useState<TabKey>(initialTab);
  const [page, setPage] = useState<number>(1);

  const ready = status === "ready";

  const handleCitationClick = (c: Citation) => {
    if (c.paper_id === paperId && c.page_start) {
      setPage(Math.max(1, c.page_start));
    } else if (c.paper_id) {
      router.push(`/papers/${c.paper_id}`);
    }
  };

  const setTabAndUrl = (next: TabKey) => {
    setTab(next);
    const params = new URLSearchParams(sp.toString());
    if (next === "chat") params.delete("tab");
    else params.set("tab", next);
    const qs = params.toString();
    router.replace(`/papers/${paperId}${qs ? `?${qs}` : ""}`, { scroll: false });
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_minmax(380px,560px)] flex-1 overflow-hidden">
      <div className="border-r overflow-hidden bg-muted/30">
        {pdfUrl ? (
          <PdfViewer url={pdfUrl} page={page} onPageChange={setPage} />
        ) : (
          <div className="h-full grid place-items-center text-sm text-muted-foreground">
            PDF unavailable.
          </div>
        )}
      </div>
      <div className="overflow-hidden flex flex-col">
        <Tabs
          value={tab}
          onValueChange={(v) => setTabAndUrl(v as TabKey)}
          className="flex-1 flex flex-col min-h-0"
        >
          <div className="border-b px-3 py-2 flex items-center justify-between gap-2">
            <TabsList>
              <TabsTrigger value="chat" icon={<MessageSquare className="h-3.5 w-3.5" />}>
                Chat
              </TabsTrigger>
              <TabsTrigger value="summary" icon={<Sparkles className="h-3.5 w-3.5" />}>
                Summary
              </TabsTrigger>
              <TabsTrigger value="terms" icon={<BookOpen className="h-3.5 w-3.5" />}>
                Terms
              </TabsTrigger>
            </TabsList>
            <Link
              href={`/compare?a=${paperId}`}
              className="inline-flex items-center gap-1 text-xs rounded-md border px-2 py-1 hover:bg-accent"
              title="Compare against another paper"
            >
              <GitCompare className="h-3 w-3" /> Compare
            </Link>
          </div>

          <TabsContent value="chat" className="flex-1 min-h-0 flex" forceMount>
            <ChatPanel
              paperId={paperId}
              chatId={chatId}
              initialMessages={initialMessages}
              summary={summary}
              status={status}
              errorMessage={error}
              onCitationClick={handleCitationClick}
              onChatCreated={(id) => {
                router.replace(`/papers/${paperId}?chat=${id}`);
              }}
              onTitleGenerated={() => router.refresh()}
              topBanner={
                <PaperChatHistory
                  paperId={paperId}
                  activeChatId={chatId}
                  chats={chatHistory}
                />
              }
            />
          </TabsContent>

          <TabsContent value="summary" className="flex-1 min-h-0" forceMount>
            {ready ? (
              <SummaryTab paperId={paperId} active={tab === "summary"} onCitationClick={handleCitationClick} />
            ) : (
              <NotReadyState status={status} />
            )}
          </TabsContent>

          <TabsContent value="terms" className="flex-1 min-h-0" forceMount>
            {ready ? (
              <TerminologyTab paperId={paperId} active={tab === "terms"} onCitationClick={handleCitationClick} />
            ) : (
              <NotReadyState status={status} />
            )}
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function NotReadyState({ status }: { status: PaperStatus }) {
  return (
    <div className="h-full grid place-items-center text-sm text-muted-foreground p-6">
      <div className="max-w-sm text-center">
        Paper is still being processed ({status}). This tab unlocks once ingestion completes.
      </div>
    </div>
  );
}
