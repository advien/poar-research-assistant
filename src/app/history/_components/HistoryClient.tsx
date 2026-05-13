"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Archive,
  ArchiveRestore,
  BookOpen,
  GitCompare,
  Pin,
  PinOff,
  Search,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";
import { cn, truncate } from "@/lib/utils";
import { relativeTime } from "@/components/chat/timeGroups";
import type { AnalysisHistoryItem, AnalysisKind } from "@/types/db";

type KindOrAll = AnalysisKind | "all";

const TAB_LABELS: Record<KindOrAll, string> = {
  all: "All",
  summary: "Summaries",
  terminology: "Terminology",
  comparison: "Comparisons",
};

export function HistoryClient({ initialKind }: { initialKind: KindOrAll }) {
  const [tab, setTab] = useState<KindOrAll>(initialKind);
  const [items, setItems] = useState<AnalysisHistoryItem[]>([]);
  const [counts, setCounts] = useState<Record<AnalysisKind, number>>({
    summary: 0,
    terminology: 0,
    comparison: 0,
  });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [archived, setArchived] = useState(false);

  useEffect(() => {
    const id = setTimeout(() => setDebouncedQ(q.trim()), 200);
    return () => clearTimeout(id);
  }, [q]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (debouncedQ) params.set("q", debouncedQ);
      if (tab !== "all") params.set("kind", tab);
      if (archived) params.set("archived", "true");
      params.set("limit", "60");
      const res = await fetch(`/api/analyses?${params.toString()}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as {
        items: AnalysisHistoryItem[];
        counts: Record<AnalysisKind, number>;
      };
      setItems(data.items ?? []);
      setCounts(data.counts ?? { summary: 0, terminology: 0, comparison: 0 });
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [tab, debouncedQ, archived]);

  useEffect(() => {
    void load();
  }, [load]);

  const total = counts.summary + counts.terminology + counts.comparison;

  const filtered = useMemo(() => items, [items]);

  const onPin = async (item: AnalysisHistoryItem) => {
    setItems((prev) => prev.map((i) => (i.id === item.id ? { ...i, pinned: !item.pinned } : i)));
    await fetch(endpointFor(item.kind, item.id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: !item.pinned }),
    });
  };

  const onArchive = async (item: AnalysisHistoryItem) => {
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await fetch(endpointFor(item.kind, item.id), {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ archived: !item.archived }),
    });
    void load();
  };

  const onDelete = async (item: AnalysisHistoryItem) => {
    if (!confirm(`Delete "${item.title || "this analysis"}"? This cannot be undone.`)) return;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    await fetch(endpointFor(item.kind, item.id), { method: "DELETE" });
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div className="relative max-w-sm w-full">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search saved analyses..."
            className="w-full h-9 rounded-md border bg-background pl-7 pr-7 text-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
          />
          {q && (
            <button
              type="button"
              aria-label="Clear search"
              onClick={() => setQ("")}
              className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-accent"
            >
              <X className="h-3 w-3" />
            </button>
          )}
        </div>
        <button
          type="button"
          onClick={() => setArchived((v) => !v)}
          className={cn(
            "inline-flex items-center gap-1 text-xs px-2 py-1 rounded-md border",
            archived ? "bg-accent" : "hover:bg-accent/60"
          )}
        >
          {archived ? <ArchiveRestore className="h-3 w-3" /> : <Archive className="h-3 w-3" />}
          {archived ? "Showing archived" : "Show archived"}
        </button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as KindOrAll)}>
        <TabsList>
          <TabsTrigger value="all">{TAB_LABELS.all} <CountBadge n={total} /></TabsTrigger>
          <TabsTrigger value="summary" icon={<Sparkles className="h-3.5 w-3.5" />}>
            {TAB_LABELS.summary} <CountBadge n={counts.summary} />
          </TabsTrigger>
          <TabsTrigger value="terminology" icon={<BookOpen className="h-3.5 w-3.5" />}>
            {TAB_LABELS.terminology} <CountBadge n={counts.terminology} />
          </TabsTrigger>
          <TabsTrigger value="comparison" icon={<GitCompare className="h-3.5 w-3.5" />}>
            {TAB_LABELS.comparison} <CountBadge n={counts.comparison} />
          </TabsTrigger>
        </TabsList>

        {(["all", "summary", "terminology", "comparison"] as const).map((kind) => (
          <TabsContent key={kind} value={kind} className="mt-3">
            {loading ? (
              <ListSkeleton />
            ) : error ? (
              <p className="text-sm text-destructive">{error}</p>
            ) : filtered.length === 0 ? (
              <EmptyState archived={archived} q={debouncedQ} />
            ) : (
              <ul className="space-y-1.5">
                {filtered.map((item) => (
                  <HistoryRow
                    key={`${item.kind}-${item.id}`}
                    item={item}
                    onPin={onPin}
                    onArchive={onArchive}
                    onDelete={onDelete}
                  />
                ))}
              </ul>
            )}
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

function CountBadge({ n }: { n: number }) {
  return (
    <span className="ml-1 text-[10px] font-mono text-muted-foreground">{n}</span>
  );
}

function HistoryRow({
  item,
  onPin,
  onArchive,
  onDelete,
}: {
  item: AnalysisHistoryItem;
  onPin: (i: AnalysisHistoryItem) => void;
  onArchive: (i: AnalysisHistoryItem) => void;
  onDelete: (i: AnalysisHistoryItem) => void;
}) {
  const href = hrefFor(item);
  return (
    <li className="group flex items-center gap-2 rounded-md border px-3 py-2 hover:bg-accent/40">
      <KindIcon kind={item.kind} />
      <Link href={href} className="flex-1 min-w-0">
        <div className="flex items-center gap-1 text-xs text-muted-foreground mb-0.5">
          <span className="uppercase tracking-wider">{item.kind}</span>
          <span>v{item.version}</span>
          <span className="ml-auto">{relativeTime(item.created_at)}</span>
        </div>
        <p className="text-sm font-medium leading-snug truncate flex items-center gap-1">
          {item.pinned && <Pin className="h-3 w-3 text-muted-foreground shrink-0" />}
          {item.title ?? "Untitled"}
        </p>
        {item.papers && item.papers.length > 0 && (
          <p className="text-[11px] text-muted-foreground truncate mt-0.5">
            {item.papers
              .map((p) => truncate(p.title ?? "Untitled", 50))
              .join(item.kind === "comparison" ? " vs " : ", ")}
          </p>
        )}
      </Link>
      <div className="flex items-center opacity-0 group-hover:opacity-100 focus-within:opacity-100">
        <button
          type="button"
          aria-label="Pin"
          onClick={() => onPin(item)}
          className="p-1 rounded hover:bg-background"
        >
          {item.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
        </button>
        <button
          type="button"
          aria-label={item.archived ? "Restore" : "Archive"}
          onClick={() => onArchive(item)}
          className="p-1 rounded hover:bg-background"
        >
          {item.archived ? (
            <ArchiveRestore className="h-3.5 w-3.5" />
          ) : (
            <Archive className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          aria-label="Delete"
          onClick={() => onDelete(item)}
          className="p-1 rounded hover:bg-background text-destructive"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </li>
  );
}

function KindIcon({ kind }: { kind: AnalysisKind }) {
  const Icon =
    kind === "summary" ? Sparkles : kind === "terminology" ? BookOpen : GitCompare;
  return (
    <span className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-muted">
      <Icon className="h-3.5 w-3.5 text-muted-foreground" />
    </span>
  );
}

function ListSkeleton() {
  return (
    <ul className="space-y-1.5">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex items-center gap-2 rounded-md border px-3 py-2">
          <Skeleton className="h-7 w-7 shrink-0" />
          <div className="flex-1 space-y-1">
            <Skeleton className="h-3 w-1/4" />
            <Skeleton className="h-4 w-3/4" />
          </div>
        </li>
      ))}
    </ul>
  );
}

function EmptyState({ archived, q }: { archived: boolean; q: string }) {
  return (
    <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
      {q
        ? "No analyses match your search."
        : archived
          ? "No archived analyses."
          : "No analyses yet. Generate a structured summary, extract terminology, or compare two papers - they will appear here."}
    </div>
  );
}

function endpointFor(kind: AnalysisKind, id: string): string {
  if (kind === "summary") return `/api/summaries/${id}`;
  if (kind === "terminology") return `/api/terminology/${id}`;
  return `/api/comparisons/${id}`;
}

function hrefFor(item: AnalysisHistoryItem): string {
  if (item.kind === "comparison") return `/compare/${item.id}`;
  if (item.paper_id) {
    const tab = item.kind === "summary" ? "summary" : "terms";
    return `/papers/${item.paper_id}?tab=${tab}`;
  }
  return "/history";
}
