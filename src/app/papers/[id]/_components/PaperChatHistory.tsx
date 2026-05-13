"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronDown, MessageSquare, Plus, Pin } from "lucide-react";
import type { ChatListItem } from "@/types/db";
import { cn, truncate } from "@/lib/utils";
import { relativeTime } from "@/components/chat/timeGroups";

type Props = {
  paperId: string;
  activeChatId: string | null;
  chats: ChatListItem[];
};

/**
 * Per-paper chat picker rendered above the chat panel. Compact dropdown so it
 * doesn't compete with the global sidebar on the /chat workspace.
 */
export function PaperChatHistory({ paperId, activeChatId, chats }: Props) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  const active = chats.find((c) => c.id === activeChatId) ?? null;

  return (
    <div ref={ref} className="border-b bg-background relative">
      <div className="flex items-center justify-between gap-2 px-4 py-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          className="flex items-center gap-1.5 text-sm font-medium hover:underline underline-offset-4 max-w-[70%] truncate"
          aria-label="Switch conversation"
        >
          <MessageSquare className="h-3.5 w-3.5 shrink-0" />
          <span className="truncate">
            {active?.title || (active ? "Untitled conversation" : "New conversation")}
          </span>
          <ChevronDown className="h-3.5 w-3.5 shrink-0" />
        </button>
        <Link
          href={`/papers/${paperId}?new=1`}
          className="inline-flex items-center gap-1 text-xs rounded-md border px-2 py-0.5 hover:bg-accent"
        >
          <Plus className="h-3 w-3" /> New chat
        </Link>
      </div>

      {open && (
        <div className="absolute left-3 right-3 top-full mt-1 z-30 max-h-80 overflow-y-auto rounded-md border bg-popover shadow-md">
          {chats.length === 0 ? (
            <p className="text-xs text-muted-foreground p-3">
              No previous conversations for this paper.
            </p>
          ) : (
            <ul className="py-1">
              {chats.map((c) => (
                <li key={c.id}>
                  <Link
                    href={`/papers/${paperId}?chat=${c.id}`}
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex items-center justify-between gap-2 px-3 py-1.5 text-sm hover:bg-accent",
                      c.id === activeChatId && "bg-accent"
                    )}
                  >
                    <span className="flex items-center gap-1.5 min-w-0">
                      {c.pinned && <Pin className="h-3 w-3 shrink-0 text-muted-foreground" />}
                      <span className="truncate">
                        {truncate(c.title, 60) || "Untitled conversation"}
                      </span>
                    </span>
                    <span className="text-[10px] text-muted-foreground shrink-0">
                      {c.message_count}m - {relativeTime(c.last_message_at ?? c.created_at)}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
