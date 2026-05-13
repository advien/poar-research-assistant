"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { PaperRow } from "@/types/db";
import { UploadDropzone } from "./UploadDropzone";
import { PaperCard } from "./PaperCard";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { CATEGORY_LABELS, groupTagsByCategory, labelFor, type TagCategory } from "@/lib/tags";

type PaperListItem = Pick<
  PaperRow,
  | "id"
  | "title"
  | "authors"
  | "journal"
  | "year"
  | "tags"
  | "page_count"
  | "status"
  | "error"
  | "summary"
  | "created_at"
>;

export function LibraryClient({ initialPapers }: { initialPapers: PaperListItem[] }) {
  const [papers, setPapers] = useState<PaperListItem[]>(initialPapers);
  const [filter, setFilter] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const tagCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of papers) for (const t of p.tags ?? []) m.set(t, (m.get(t) ?? 0) + 1);
    return m;
  }, [papers]);

  /** Tags actually present in the library, grouped by category for the filter row. */
  const groupedTags = useMemo(() => {
    const all = Array.from(tagCounts.keys());
    const { groups, unknown } = groupTagsByCategory(all);
    const sortByCount = (a: string, b: string) => (tagCounts.get(b) ?? 0) - (tagCounts.get(a) ?? 0);
    return {
      groups: groups.map((g) => ({ ...g, tags: [...g.tags].sort(sortByCount) })),
      unknown: [...unknown].sort(sortByCount),
    };
  }, [tagCounts]);

  // Realtime subscription on the papers table for the signed-in user.
  // We treat INSERT as an upsert because the upload flow ALSO inserts an
  // optimistic placeholder with the same id via `onUploadStart`. Without the
  // dedupe, a single upload would render two cards with the same React key.
  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel("papers-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "papers" },
        (payload) => {
          setPapers((prev) => {
            if (payload.eventType === "INSERT") {
              const row = payload.new as PaperListItem;
              const existing = prev.find((p) => p.id === row.id);
              if (existing) {
                // Already in state (likely from optimistic placeholder).
                // Merge the authoritative DB row over the placeholder.
                return prev.map((p) => (p.id === row.id ? { ...p, ...row } : p));
              }
              return [row, ...prev];
            }
            if (payload.eventType === "UPDATE") {
              const row = payload.new as PaperListItem;
              const exists = prev.some((p) => p.id === row.id);
              if (!exists) {
                // UPDATE for a row we never saw INSERT for - add it.
                return [row, ...prev];
              }
              return prev.map((p) => (p.id === row.id ? { ...p, ...row } : p));
            }
            if (payload.eventType === "DELETE") {
              const oldId = (payload.old as { id: string }).id;
              return prev.filter((p) => p.id !== oldId);
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, []);

  const onUploadStart = useCallback((p: PaperListItem) => {
    setPapers((prev) => [p, ...prev.filter((x) => x.id !== p.id)]);
  }, []);

  const onDelete = useCallback(async (id: string) => {
    if (!confirm("Delete this paper and all its chunks?")) return;
    const res = await fetch(`/api/papers/${id}`, { method: "DELETE" });
    if (res.ok) setPapers((prev) => prev.filter((p) => p.id !== id));
  }, []);

  const filtered = useMemo(() => {
    let list = papers;
    if (activeTag) list = list.filter((p) => (p.tags ?? []).includes(activeTag));
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter((p) =>
        [
          p.title,
          p.journal,
          p.summary,
          (p.authors ?? []).join(" "),
          (p.tags ?? []).join(" "),
        ]
          .filter(Boolean)
          .some((s) => s!.toLowerCase().includes(q))
      );
    }
    return list;
  }, [papers, filter, activeTag]);

  return (
    <div className="space-y-6">
      <UploadDropzone onUploadStart={onUploadStart} />
      <div className="flex items-center justify-between gap-4">
        <Input
          placeholder="Filter by title, author, journal, tag..."
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="max-w-sm"
        />
        <p className="text-sm text-muted-foreground">{filtered.length} papers</p>
      </div>
      {tagCounts.size > 0 && (
        <div className="space-y-2">
          <button
            type="button"
            onClick={() => setActiveTag(null)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs",
              activeTag === null ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
          >
            all
          </button>
          {groupedTags.groups.map((g) => (
            <TagCategoryRow
              key={g.category}
              label={CATEGORY_LABELS[g.category as TagCategory]}
              tags={g.tags}
              counts={tagCounts}
              activeTag={activeTag}
              onPick={(t) => setActiveTag(t === activeTag ? null : t)}
            />
          ))}
          {groupedTags.unknown.length > 0 && (
            <TagCategoryRow
              label="Other"
              tags={groupedTags.unknown}
              counts={tagCounts}
              activeTag={activeTag}
              onPick={(t) => setActiveTag(t === activeTag ? null : t)}
              muted
            />
          )}
        </div>
      )}
      {filtered.length === 0 ? (
        <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
          {papers.length === 0
            ? "No papers yet. Drop a PDF above to get started."
            : "No papers match the current filter."}
        </div>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filtered.map((p) => (
            <PaperCard key={p.id} paper={p} onDelete={onDelete} />
          ))}
        </div>
      )}
    </div>
  );
}

function TagCategoryRow({
  label,
  tags,
  counts,
  activeTag,
  onPick,
  muted,
}: {
  label: string;
  tags: string[];
  counts: Map<string, number>;
  activeTag: string | null;
  onPick: (t: string) => void;
  muted?: boolean;
}) {
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span
        className={cn(
          "text-[10px] uppercase tracking-wider mr-1",
          muted ? "text-muted-foreground/60" : "text-muted-foreground"
        )}
      >
        {label}
      </span>
      {tags.map((tag) => {
        const count = counts.get(tag) ?? 0;
        return (
          <button
            key={tag}
            type="button"
            onClick={() => onPick(tag)}
            className={cn(
              "rounded-md border px-2 py-0.5 text-xs transition-colors",
              tag === activeTag ? "bg-primary text-primary-foreground" : "hover:bg-accent"
            )}
          >
            {labelFor(tag)}
            <Badge variant="outline" className="ml-1 px-1 py-0 text-[10px] font-normal">
              {count}
            </Badge>
          </button>
        );
      })}
    </div>
  );
}
