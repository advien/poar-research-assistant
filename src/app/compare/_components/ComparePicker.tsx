"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, Loader2, Sparkles, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { truncate } from "@/lib/utils";

type Paper = { id: string; title: string | null; authors: string[]; year: number | null };
type RecentComparison = {
  id: string;
  paper_a_id: string;
  paper_b_id: string;
  title: string | null;
  similarity_score: number | null;
  stronger_paper: "a" | "b" | "tie" | "undetermined" | null;
  contradiction_count: number;
  pinned: boolean;
  created_at: string;
};

type Props = {
  papers: Paper[];
  recent: RecentComparison[];
  defaultA: string | null;
  defaultB: string | null;
};

export function ComparePicker({ papers, recent, defaultA, defaultB }: Props) {
  const router = useRouter();
  const [a, setA] = useState<string>(defaultA ?? "");
  const [b, setB] = useState<string>(defaultB ?? "");
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const byId = useMemo(() => new Map(papers.map((p) => [p.id, p])), [papers]);

  const canCompare = a && b && a !== b;

  const generate = async () => {
    if (!canCompare) return;
    setGenerating(true);
    setError(null);
    try {
      const res = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ paper_a_id: a, paper_b_id: b }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail ?? j.error ?? `HTTP ${res.status}`);
      router.push(`/compare/${j.comparison.id}`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Pick two papers</CardTitle>
          <CardDescription>Both papers must be fully ingested.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
            <PaperPicker papers={papers} value={a} onChange={setA} disabledId={b} label="Paper A" />
            <div className="flex items-center justify-center text-muted-foreground">
              <ArrowRight className="h-5 w-5" />
            </div>
            <PaperPicker papers={papers} value={b} onChange={setB} disabledId={a} label="Paper B" />
          </div>
          {error && (
            <div className="mt-3 flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3 text-sm">
              <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
              <p className="text-muted-foreground">{error}</p>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between">
            <div className="text-xs text-muted-foreground">
              {a && b && a === b
                ? "Pick two different papers."
                : canCompare
                  ? `Comparing "${truncate(byId.get(a)?.title ?? "", 40)}" vs "${truncate(byId.get(b)?.title ?? "", 40)}"`
                  : papers.length === 0
                    ? "No ready papers yet. Upload and ingest at least two."
                    : "Select papers above to enable comparison."}
            </div>
            <Button onClick={generate} disabled={!canCompare || generating}>
              {generating ? (
                <Loader2 className="h-4 w-4 mr-1 animate-spin" />
              ) : (
                <Sparkles className="h-4 w-4 mr-1" />
              )}
              Generate comparison
            </Button>
          </div>
        </CardContent>
      </Card>

      {recent.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Recent comparisons</CardTitle>
            <CardDescription>Click to reopen any saved analysis.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-2">
            {recent.map((c) => {
              const titleA = byId.get(c.paper_a_id)?.title ?? "Paper A";
              const titleB = byId.get(c.paper_b_id)?.title ?? "Paper B";
              return (
                <Link
                  key={c.id}
                  href={`/compare/${c.id}`}
                  className="flex items-center justify-between gap-2 rounded-md border px-3 py-2 hover:bg-accent text-sm"
                >
                  <div className="min-w-0">
                    <p className="font-medium truncate">
                      {c.title ?? `${truncate(titleA, 30)} vs ${truncate(titleB, 30)}`}
                    </p>
                    <p className="text-xs text-muted-foreground">
                      {new Date(c.created_at).toLocaleDateString()}
                    </p>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    {typeof c.similarity_score === "number" && (
                      <Badge variant="outline" className="font-mono text-[10px]">
                        sim {(c.similarity_score * 100).toFixed(0)}%
                      </Badge>
                    )}
                    {c.contradiction_count > 0 && (
                      <Badge variant="destructive" className="text-[10px]">
                        {c.contradiction_count} conflict{c.contradiction_count === 1 ? "" : "s"}
                      </Badge>
                    )}
                    {c.stronger_paper && c.stronger_paper !== "undetermined" && (
                      <Badge variant="secondary" className="text-[10px]">
                        stronger: {c.stronger_paper.toUpperCase()}
                      </Badge>
                    )}
                  </div>
                </Link>
              );
            })}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaperPicker({
  papers,
  value,
  onChange,
  disabledId,
  label,
}: {
  papers: Paper[];
  value: string;
  onChange: (id: string) => void;
  disabledId: string;
  label: string;
}) {
  return (
    <div className="space-y-1">
      <label className="text-xs uppercase tracking-wider text-muted-foreground">{label}</label>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full h-9 rounded-md border bg-background px-2 text-sm"
      >
        <option value="">Select a paper...</option>
        {papers.map((p) => (
          <option key={p.id} value={p.id} disabled={p.id === disabledId}>
            {truncate(p.title ?? "Untitled", 80)}
            {p.year ? ` (${p.year})` : ""}
          </option>
        ))}
      </select>
    </div>
  );
}
