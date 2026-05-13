"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatListItem, ChatListPage } from "@/types/db";

export type ConversationFilters = {
  q: string;
  paperId: string | null;
  archived: boolean;
};

const PAGE_SIZE = 30;

/** Stateful hook backing the conversation sidebar. Handles search, pagination,
 *  optimistic mutations, and graceful refresh. */
export function useConversations(initial: ConversationFilters = {
  q: "",
  paperId: null,
  archived: false,
}) {
  const [filters, setFilters] = useState<ConversationFilters>(initial);
  const [pinned, setPinned] = useState<ChatListItem[]>([]);
  const [items, setItems] = useState<ChatListItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const reqRef = useRef(0);

  const load = useCallback(
    async (reset: boolean) => {
      const reqId = ++reqRef.current;
      if (reset) setLoading(true);
      else setLoadingMore(true);
      try {
        const params = new URLSearchParams();
        if (filters.q) params.set("q", filters.q);
        if (filters.paperId) params.set("paper_id", filters.paperId);
        if (filters.archived) params.set("archived", "true");
        params.set("limit", String(PAGE_SIZE));
        if (!reset && cursor) params.set("cursor", cursor);

        const res = await fetch(`/api/chats?${params.toString()}`);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as ChatListPage;

        if (reqRef.current !== reqId) return; // stale response
        if (reset) {
          setPinned(data.pinned ?? []);
          setItems(data.items ?? []);
        } else {
          setItems((prev) => [...prev, ...(data.items ?? [])]);
        }
        setCursor(data.next_cursor);
        setHasMore(!!data.next_cursor);
        setError(null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        if (reqRef.current === reqId) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filters, cursor]
  );

  // Re-run when filters change. Cursor is intentionally excluded so that filter
  // changes always restart pagination.
  useEffect(() => {
    setCursor(null);
    void load(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.q, filters.paperId, filters.archived]);

  const loadMore = useCallback(() => {
    if (!hasMore || loadingMore) return;
    void load(false);
  }, [hasMore, loadingMore, load]);

  const refresh = useCallback(() => {
    setCursor(null);
    void load(true);
  }, [load]);

  // -------------------------------------------------------------------------
  // Optimistic mutations
  // -------------------------------------------------------------------------
  const upsertOptimistic = useCallback((patch: Partial<ChatListItem> & { id: string }) => {
    const apply = (list: ChatListItem[]) =>
      list.map((c) => (c.id === patch.id ? { ...c, ...patch } : c));
    setPinned(apply);
    setItems(apply);
  }, []);

  const removeOptimistic = useCallback((id: string) => {
    setPinned((p) => p.filter((c) => c.id !== id));
    setItems((p) => p.filter((c) => c.id !== id));
  }, []);

  const togglePin = useCallback(
    async (chat: ChatListItem) => {
      const next = !chat.pinned;
      upsertOptimistic({ id: chat.id, pinned: next });
      try {
        const res = await fetch(`/api/chats/${chat.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ pinned: next }),
        });
        if (!res.ok) throw new Error(await res.text());
        refresh();
      } catch (e) {
        upsertOptimistic({ id: chat.id, pinned: !next });
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh, upsertOptimistic]
  );

  const toggleArchive = useCallback(
    async (chat: ChatListItem) => {
      const next = !chat.archived;
      removeOptimistic(chat.id);
      try {
        const res = await fetch(`/api/chats/${chat.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ archived: next }),
        });
        if (!res.ok) throw new Error(await res.text());
        refresh();
      } catch (e) {
        refresh();
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [refresh, removeOptimistic]
  );

  const rename = useCallback(
    async (chat: ChatListItem, title: string) => {
      const t = title.trim().slice(0, 160);
      if (!t || t === chat.title) return;
      upsertOptimistic({ id: chat.id, title: t });
      try {
        const res = await fetch(`/api/chats/${chat.id}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ title: t }),
        });
        if (!res.ok) throw new Error(await res.text());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        refresh();
      }
    },
    [refresh, upsertOptimistic]
  );

  const remove = useCallback(
    async (chat: ChatListItem) => {
      removeOptimistic(chat.id);
      try {
        const res = await fetch(`/api/chats/${chat.id}`, { method: "DELETE" });
        if (!res.ok) throw new Error(await res.text());
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        refresh();
      }
    },
    [refresh, removeOptimistic]
  );

  return {
    filters,
    setFilters,
    pinned,
    items,
    hasMore,
    loading,
    loadingMore,
    error,
    refresh,
    loadMore,
    togglePin,
    toggleArchive,
    rename,
    remove,
    upsertOptimistic,
  };
}
