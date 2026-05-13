"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Plus,
  Archive,
  ArchiveRestore,
  X,
  Pin,
  ChevronDown,
} from "lucide-react";
import type { ChatListItem } from "@/types/db";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { useConversations } from "./useConversations";
import { ConversationItem } from "./ConversationItem";
import { groupByBucket } from "./timeGroups";
import { cn } from "@/lib/utils";

type Props = {
  activeChatId: string | null;
  /** When set, render `New chat` link to /papers/<id>?new=1 etc.; otherwise /chat. */
  newChatHref?: string;
  /** Build the URL for an item; default routes paper-chats to the paper page. */
  hrefForChat?: (c: ChatListItem) => string;
  onItemClick?: () => void;
};

export function ConversationSidebar({
  activeChatId,
  newChatHref = "/chat",
  hrefForChat,
  onItemClick,
}: Props) {
  const router = useRouter();
  const {
    filters,
    setFilters,
    pinned,
    items,
    hasMore,
    loading,
    loadingMore,
    error,
    loadMore,
    togglePin,
    toggleArchive,
    rename,
    remove,
  } = useConversations();

  const [searchValue, setSearchValue] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);

  // Debounce search input -> filters.q
  useEffect(() => {
    const id = setTimeout(() => {
      setFilters((f) => ({ ...f, q: searchValue.trim() }));
    }, 200);
    return () => clearTimeout(id);
  }, [searchValue, setFilters]);

  // Keyboard shortcut: Cmd/Ctrl+K focuses search; Cmd/Ctrl+Shift+O opens new chat.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "k") {
        e.preventDefault();
        searchRef.current?.focus();
        searchRef.current?.select();
      } else if (mod && e.shiftKey && e.key.toLowerCase() === "o") {
        e.preventDefault();
        router.push(newChatHref);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [newChatHref, router]);

  const buildHref = useMemo(() => {
    return (
      hrefForChat ??
      ((c: ChatListItem) =>
        c.paper_id ? `/papers/${c.paper_id}?chat=${c.id}` : `/chat/${c.id}`)
    );
  }, [hrefForChat]);

  const grouped = useMemo(() => groupByBucket(items), [items]);

  return (
    <aside className="h-full flex flex-col border-r bg-card text-card-foreground">
      <div className="p-3 space-y-2 border-b">
        <Link href={newChatHref} className="block">
          <Button className="w-full justify-start gap-2" size="sm" onClick={onItemClick}>
            <Plus className="h-4 w-4" />
            New conversation
          </Button>
        </Link>
        <div className="relative">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            ref={searchRef}
            value={searchValue}
            onChange={(e) => setSearchValue(e.target.value)}
            placeholder="Search conversations  (Ctrl+K)"
            className="w-full h-8 rounded-md border bg-background pl-7 pr-7 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {searchValue && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setSearchValue("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setFilters((f) => ({ ...f, archived: !f.archived }))}
          className={cn(
            "inline-flex items-center gap-1 text-[11px] px-2 py-1 rounded-md border w-full justify-center",
            filters.archived ? "bg-accent" : "hover:bg-accent/60"
          )}
        >
          {filters.archived ? (
            <>
              <ArchiveRestore className="h-3 w-3" /> Showing archived - back to active
            </>
          ) : (
            <>
              <Archive className="h-3 w-3" /> Show archived
            </>
          )}
        </button>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {loading ? (
          <SidebarSkeleton />
        ) : error ? (
          <p className="text-xs text-destructive p-2">{error}</p>
        ) : pinned.length === 0 && items.length === 0 ? (
          <EmptyState archived={filters.archived} searching={!!filters.q} />
        ) : (
          <div className="space-y-3">
            {pinned.length > 0 && (
              <Section label="Pinned" icon={<Pin className="h-3 w-3" />}>
                {pinned.map((c) => (
                  <ConversationItem
                    key={c.id}
                    chat={c}
                    active={c.id === activeChatId}
                    href={buildHref(c)}
                    onPin={togglePin}
                    onArchive={toggleArchive}
                    onRename={rename}
                    onDelete={remove}
                  />
                ))}
              </Section>
            )}
            {grouped.map((g) => (
              <Section key={g.label} label={g.label}>
                {g.items.map((c) => (
                  <ConversationItem
                    key={c.id}
                    chat={c}
                    active={c.id === activeChatId}
                    href={buildHref(c)}
                    onPin={togglePin}
                    onArchive={toggleArchive}
                    onRename={rename}
                    onDelete={remove}
                  />
                ))}
              </Section>
            ))}
            {hasMore && (
              <button
                type="button"
                onClick={loadMore}
                disabled={loadingMore}
                className="w-full inline-flex items-center justify-center gap-1 text-xs py-1.5 rounded-md border hover:bg-accent disabled:opacity-50"
              >
                <ChevronDown className="h-3 w-3" />
                {loadingMore ? "Loading..." : "Load more"}
              </button>
            )}
          </div>
        )}
      </div>
    </aside>
  );
}

function Section({
  label,
  icon,
  children,
}: {
  label: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h4 className="px-2 mb-1 text-[10px] uppercase tracking-wider text-muted-foreground flex items-center gap-1">
        {icon}
        {label}
      </h4>
      <div className="space-y-0.5">{children}</div>
    </section>
  );
}

function SidebarSkeleton() {
  return (
    <div className="space-y-2 p-1">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="space-y-1">
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-3 w-1/2" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ archived, searching }: { archived: boolean; searching: boolean }) {
  return (
    <div className="text-center text-xs text-muted-foreground p-6 space-y-1">
      {searching ? (
        <>No conversations match your search.</>
      ) : archived ? (
        <>No archived conversations.</>
      ) : (
        <>
          <p>No conversations yet.</p>
          <p>Start a new chat or open a paper to begin.</p>
        </>
      )}
    </div>
  );
}
