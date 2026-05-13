"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BookOpen,
  RefreshCw,
  AlertTriangle,
  Search,
  X,
  Pin,
  PinOff,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { CitationBadges } from "@/components/analyses/CitationBadges";
import { Drawer } from "@/components/ui/drawer";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { resolveStoredTerminology } from "@/lib/analyses/resolve";
import type { ResolvedTerm } from "@/lib/analyses/generateTerminology";
import type { Citation, TerminologyRow } from "@/types/db";
import { cn } from "@/lib/utils";

type Props = {
  paperId: string;
  active: boolean;
  onCitationClick?: (c: Citation) => void;
};

const CATEGORY_LABEL: Record<ResolvedTerm["category"], string> = {
  biomechanics: "Biomechanics",
  anatomy: "Anatomy",
  device: "Device",
  material: "Material",
  sensor: "Sensor",
  outcome_measure: "Outcome measure",
  method: "Method",
  acronym: "Acronym",
  other: "Other",
};

export function TerminologyTab({ paperId, active, onCitationClick }: Props) {
  const [terminology, setTerminology] = useState<TerminologyRow | null>(null);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [activeCategory, setActiveCategory] = useState<string>("all");
  const [openTerm, setOpenTerm] = useState<ResolvedTerm | null>(null);

  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (active && !touched) setTouched(true);
  }, [active, touched]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/papers/${paperId}/terminology`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { terminology: TerminologyRow | null };
      setTerminology(data.terminology);
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  useEffect(() => {
    if (touched) void load();
  }, [touched, load]);

  const generate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch(`/api/papers/${paperId}/terminology`, { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        throw new Error(j.detail ?? j.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  const togglePin = async () => {
    if (!terminology) return;
    const next = !terminology.pinned;
    setTerminology({ ...terminology, pinned: next });
    await fetch(`/api/terminology/${terminology.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: next }),
    });
  };

  const terms = useMemo<ResolvedTerm[]>(() => {
    if (!terminology) return [];
    return resolveStoredTerminology(terminology.payload, terminology.citations);
  }, [terminology]);

  const categories = useMemo(() => {
    const map = new Map<string, number>();
    for (const t of terms) map.set(t.category, (map.get(t.category) ?? 0) + 1);
    return Array.from(map.entries()).sort((a, b) => b[1] - a[1]);
  }, [terms]);

  const filtered = useMemo(() => {
    let list = terms;
    if (activeCategory !== "all") list = list.filter((t) => t.category === activeCategory);
    if (filter.trim()) {
      const q = filter.toLowerCase();
      list = list.filter((t) =>
        [
          t.term,
          t.expansion ?? "",
          t.beginner_explanation,
          t.technical_explanation,
          t.clinical_context,
        ]
          .join(" ")
          .toLowerCase()
          .includes(q)
      );
    }
    return list;
  }, [terms, filter, activeCategory]);

  if (!touched) return null;

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[200px_minmax(0,1fr)] h-full overflow-hidden">
      <nav className="hidden lg:block border-r p-3 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Categories
        </p>
        <ul className="space-y-0.5 text-sm">
          <li>
            <button
              type="button"
              onClick={() => setActiveCategory("all")}
              className={cn(
                "w-full text-left rounded px-2 py-1 hover:bg-accent flex items-center justify-between",
                activeCategory === "all" && "bg-accent font-medium"
              )}
            >
              <span>All</span>
              <span className="text-xs text-muted-foreground">{terms.length}</span>
            </button>
          </li>
          {categories.map(([cat, count]) => (
            <li key={cat}>
              <button
                type="button"
                onClick={() => setActiveCategory(cat)}
                className={cn(
                  "w-full text-left rounded px-2 py-1 hover:bg-accent flex items-center justify-between",
                  activeCategory === cat && "bg-accent font-medium"
                )}
              >
                <span>{CATEGORY_LABEL[cat as ResolvedTerm["category"]] ?? cat}</span>
                <span className="text-xs text-muted-foreground">{count}</span>
              </button>
            </li>
          ))}
        </ul>
      </nav>

      <div className="overflow-y-auto">
        <header className="sticky top-0 z-10 bg-background border-b px-5 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <BookOpen className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Terminology</span>
            {terminology && (
              <Badge variant="outline" className="font-mono text-[10px]">
                v{terminology.version} - {terminology.term_count} terms
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {terminology && (
              <Button variant="ghost" size="sm" onClick={togglePin}>
                {terminology.pinned ? (
                  <PinOff className="h-3.5 w-3.5" />
                ) : (
                  <Pin className="h-3.5 w-3.5" />
                )}
              </Button>
            )}
            <Button
              size="sm"
              variant={terminology ? "outline" : "default"}
              onClick={generate}
              disabled={generating}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", generating && "animate-spin")} />
              {terminology ? "Re-extract" : "Extract terms"}
            </Button>
          </div>
        </header>

        <div className="px-5 py-3 border-b">
          <div className="relative max-w-sm">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter terms..."
              className="w-full h-8 rounded-md border bg-background pl-7 pr-7 text-xs focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
            />
            {filter && (
              <button
                type="button"
                onClick={() => setFilter("")}
                className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded p-0.5 hover:bg-accent"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>

        <div className="px-5 py-4">
          {loading ? (
            <TermsSkeleton />
          ) : error ? (
            <ErrorState message={error} onRetry={generate} />
          ) : !terminology ? (
            <EmptyState onGenerate={generate} />
          ) : filtered.length === 0 ? (
            <p className="text-sm text-muted-foreground">No terms match the current filter.</p>
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
              {filtered.map((t) => (
                <TermCard key={t.term} term={t} onOpen={setOpenTerm} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <Drawer open={!!openTerm} onOpenChange={() => setOpenTerm(null)} side="right">
        {openTerm && <TermDrawer term={openTerm} onCitationClick={onCitationClick} />}
      </Drawer>
    </div>
  );
}

function TermCard({
  term,
  onOpen,
}: {
  term: ResolvedTerm;
  onOpen: (t: ResolvedTerm) => void;
}) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(term)}
        className="w-full text-left rounded-lg border p-3 hover:bg-accent/40 transition-colors"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <h4 className="font-medium leading-tight">{term.term}</h4>
            {term.expansion && (
              <p className="text-xs text-muted-foreground italic">{term.expansion}</p>
            )}
          </div>
          <Badge variant="secondary" className="shrink-0 text-[10px]">
            {CATEGORY_LABEL[term.category] ?? term.category}
          </Badge>
        </div>
        <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
          {term.beginner_explanation}
        </p>
      </button>
    </li>
  );
}

function TermDrawer({
  term,
  onCitationClick,
}: {
  term: ResolvedTerm;
  onCitationClick?: (c: Citation) => void;
}) {
  return (
    <div className="flex flex-col h-full">
      <header className="border-b p-4 space-y-1">
        <div className="flex items-center gap-2">
          <h3 className="text-base font-semibold leading-tight">{term.term}</h3>
          <Badge variant="secondary" className="text-[10px]">
            {CATEGORY_LABEL[term.category] ?? term.category}
          </Badge>
        </div>
        {term.expansion && <p className="text-sm text-muted-foreground italic">{term.expansion}</p>}
        {term.pronunciation && (
          <p className="text-xs text-muted-foreground">/{term.pronunciation}/</p>
        )}
      </header>

      <Tabs defaultValue="beginner" className="flex-1 flex flex-col overflow-hidden">
        <div className="border-b p-2">
          <TabsList className="w-full">
            <TabsTrigger value="beginner" className="flex-1 text-xs">
              Beginner
            </TabsTrigger>
            <TabsTrigger value="technical" className="flex-1 text-xs">
              Technical
            </TabsTrigger>
            <TabsTrigger value="clinical" className="flex-1 text-xs">
              Clinical context
            </TabsTrigger>
          </TabsList>
        </div>
        <div className="flex-1 overflow-y-auto p-4 text-sm leading-relaxed">
          <TabsContent value="beginner">{term.beginner_explanation}</TabsContent>
          <TabsContent value="technical">{term.technical_explanation}</TabsContent>
          <TabsContent value="clinical">{term.clinical_context}</TabsContent>
        </div>
      </Tabs>

      {term.citations.length > 0 && (
        <footer className="border-t p-3 space-y-1">
          <p className="text-[10px] uppercase tracking-wider text-muted-foreground">Sources</p>
          <CitationBadges citations={term.citations} onClick={onCitationClick} />
        </footer>
      )}
    </div>
  );
}

function TermsSkeleton() {
  return (
    <ul className="grid grid-cols-1 md:grid-cols-2 gap-3">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="rounded-lg border p-3 space-y-2">
          <Skeleton className="h-4 w-1/2" />
          <Skeleton className="h-3 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
        </li>
      ))}
    </ul>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-md space-y-3 text-sm">
      <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
        <p>
          <span className="font-medium text-destructive">Extraction failed.</span>{" "}
          <span className="text-muted-foreground">{message}</span>
        </p>
      </div>
      <Button onClick={onRetry} size="sm">
        <RefreshCw className="h-3.5 w-3.5 mr-1" /> Try again
      </Button>
    </div>
  );
}

function EmptyState({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="max-w-md space-y-3 text-sm text-muted-foreground">
      <p>
        No terminology extracted yet. Run extraction to get plain-English, technical, and clinical
        explanations for every domain term in this paper.
      </p>
      <Button onClick={onGenerate}>
        <BookOpen className="h-3.5 w-3.5 mr-1" /> Extract terms
      </Button>
    </div>
  );
}
