"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { ConversationSidebar } from "./ConversationSidebar";
import type { ChatListItem } from "@/types/db";

type Props = {
  activeChatId: string | null;
  newChatHref?: string;
  hrefForChat?: (c: ChatListItem) => string;
  /** Right-hand main pane content. */
  children: React.ReactNode;
  /** Optional sticky header rendered above the children. */
  header?: React.ReactNode;
};

export function ChatWorkspaceLayout({
  activeChatId,
  newChatHref,
  hrefForChat,
  children,
  header,
}: Props) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <div className="grid lg:grid-cols-[300px_minmax(0,1fr)] h-[calc(100vh-3.5rem)]">
      <div className="hidden lg:block min-h-0">
        <ConversationSidebar
          activeChatId={activeChatId}
          newChatHref={newChatHref}
          hrefForChat={hrefForChat}
        />
      </div>
      <div className="flex flex-col min-h-0">
        <div className="lg:hidden flex items-center gap-2 border-b px-3 py-2">
          <Button
            variant="ghost"
            size="icon"
            aria-label="Open conversations"
            onClick={() => setMobileOpen(true)}
          >
            <Menu className="h-4 w-4" />
          </Button>
          <span className="text-sm text-muted-foreground">Conversations</span>
        </div>
        {header}
        <div className="flex-1 min-h-0 overflow-hidden">{children}</div>
      </div>

      <Drawer open={mobileOpen} onOpenChange={setMobileOpen} side="left">
        <ConversationSidebar
          activeChatId={activeChatId}
          newChatHref={newChatHref}
          hrefForChat={hrefForChat}
          onItemClick={() => setMobileOpen(false)}
        />
      </Drawer>
    </div>
  );
}
