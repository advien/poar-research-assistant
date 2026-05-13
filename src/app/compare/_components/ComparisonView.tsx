"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  Pin,
  PinOff,
  RefreshCw,
  Trash2,
  Trophy,
  ExternalLink,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Collapsible } from "@/components/ui/collapsible";
import { resolvedComparison } from "@/lib/analyses/resolve";
import type { ComparisonRow } from "@/types/db";
import { cn } from "@/lib/utils";

type Paper = { id: string; title: string | null; authors: string[]; year: number | null };

type Props = {
  comparison: ComparisonRow;
  paperA: Paper | null;
  paperB: Paper | null;
};

export function ComparisonView({ comparison, paperA, paperB }: Props) {
  const router = useRouter();
  const [pinned, setPinned] = useState(comparison.pinned);
  const [regenerating, setRegenerating] = useState(false);

  const data = useMemo(
    () => resolvedComparison(comparison.payload, comparison.citations),
    [comparison]
  );

  const togglePin = async () => {
    const next = !pinned;
    setPinned(next);
    await fetch(`/api/comparisons/${comparison.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: next }),
    });
  };

  const regenerate = async () => {
    setRegenerating(true);
    try {
      const res = await fetch("/api/comparisons", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          paper_a_id: comparison.paper_a_id,
          paper_b_id: comparison.paper_b_id,
        }),
      });
      const j = await res.json();
      if (!res.ok) throw new Error(j.detail ?? j.error);
      router.push(`/compare/${j.comparison.id}`);
    } catch (e) {
      alert(e instanceof Error ? e.message : String(e));
    } finally {
      setRegenerating(false);
    }
  };

  const remove = async () => {
    if (!confirm("Delete this comparison?")) return;
    await fetch(`/api/comparisons/${comparison.id}`, { method: "DELETE" });
    router.push("/compare");
  };

  return (
    <div className="space-y-4">
      <header className="flex items-start justify-between gap-3">
        <div className="space-y-2 min-w-0">
          <h1 className="text-xl font-semibold tracking-tight leading-tight">
            {comparison.title ?? "Comparison"}{" "}
            <span className="font-mono text-xs text-muted-foreground">v{comparison.version}</span>
          </h1>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Badge variant="outline" className="font-mono">
              similarity {((data.similarity_score ?? 0) * 100).toFixed(0)}%
            </Badge>
            {data.stronger_paper && data.stronger_paper !== "undetermined" && (
              <Badge variant="success" className="gap-1">
                <Trophy className="h-3 w-3" /> stronger: paper {data.stronger_paper.toUpperCase()}
              </Badge>
            )}
            {data.stronger_paper === "tie" && <Badge variant="secondary">tie</Badge>}
            {data.contradictions.length > 0 && (
              <Badge variant="destructive" className="gap-1">
                <AlertTriangle className="h-3 w-3" /> {data.contradictions.length} contradiction
                {data.contradictions.length === 1 ? "" : "s"}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          <Button variant="ghost" size="icon" onClick={togglePin} aria-label="Pin">
            {pinned ? <PinOff className="h-4 w-4" /> : <Pin className="h-4 w-4" />}
          </Button>
          <Button variant="outline" size="sm" onClick={regenerate} disabled={regenerating}>
            <RefreshCw className={cn("h-3.5 w-3.5 mr-1", regenerating && "animate-spin")} />
            Regenerate
          </Button>
          <Button variant="ghost" size="icon" onClick={remove} aria-label="Delete">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <PaperHeaderCard label="Paper A" paper={paperA} />
        <PaperHeaderCard label="Paper B" paper={paperB} />
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Overall assessment</CardTitle>
        </CardHeader>
        <CardContent className="space-y-2">
          <p className="text-sm leading-relaxed">{data.overall_assessment.text}</p>
          <CompareCitations
            citations={data.overall_assessment.citations}
            paperA={paperA}
            paperB={paperB}
          />
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          <CompareRow
            id="cmp-methodology"
            label="Methodology"
            a={data.methodology.a}
            b={data.methodology.b}
            citations={data.methodology.citations}
            paperA={paperA}
            paperB={paperB}
          />
          <CompareRow
            id="cmp-participants"
            label="Participants & sample"
            a={data.participants.a}
            b={data.participants.b}
            citations={data.participants.citations}
            paperA={paperA}
            paperB={paperB}
          />
          <CompareRow
            id="cmp-outcomes"
            label="Outcome measures"
            a={data.outcome_measures.a}
            b={data.outcome_measures.b}
            citations={data.outcome_measures.citations}
            paperA={paperA}
            paperB={paperB}
          />
          <CompareRow
            id="cmp-devices"
            label="Devices & sensors"
            a={data.devices_sensors.a}
            b={data.devices_sensors.b}
            citations={data.devices_sensors.citations}
            paperA={paperA}
            paperB={paperB}
          />
          <CompareRow
            id="cmp-rehab"
            label="Rehabilitation approach"
            a={data.rehabilitation_approach.a}
            b={data.rehabilitation_approach.b}
            citations={data.rehabilitation_approach.citations}
            paperA={paperA}
            paperB={paperB}
          />
          <CompareRow
            id="cmp-strengths"
            label="Strengths"
            a={data.strengths.a}
            b={data.strengths.b}
            citations={data.strengths.citations}
            paperA={paperA}
            paperB={paperB}
          />
          <CompareRow
            id="cmp-weaknesses"
            label="Weaknesses"
            a={data.weaknesses.a}
            b={data.weaknesses.b}
            citations={data.weaknesses.citations}
            paperA={paperA}
            paperB={paperB}
          />
          <CompareRow
            id="cmp-clinical"
            label="Clinical implications"
            a={data.clinical_implications.a}
            b={data.clinical_implications.b}
            citations={data.clinical_implications.citations}
            paperA={paperA}
            paperB={paperB}
          />
        </CardContent>
      </Card>

      {data.contradictions.length > 0 && (
        <Card className="border-destructive/40">
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive" /> Contradictions
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {data.contradictions.map((c, i) => (
              <Collapsible
                key={i}
                title={c.topic}
                defaultOpen={i === 0}
                trailing={
                  <Badge variant="outline" className="text-[10px]">
                    {c.citations.length} src
                  </Badge>
                }
              >
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-sm">
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Paper A claims
                    </p>
                    <p>{c.paper_a_claim}</p>
                  </div>
                  <div className="rounded-md border bg-muted/30 p-3">
                    <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-1">
                      Paper B claims
                    </p>
                    <p>{c.paper_b_claim}</p>
                  </div>
                </div>
                <CompareCitations
                  citations={c.citations}
                  paperA={paperA}
                  paperB={paperB}
                  className="mt-2"
                />
              </Collapsible>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function PaperHeaderCard({ label, paper }: { label: string; paper: Paper | null }) {
  if (!paper) {
    return (
      <Card>
        <CardContent className="p-3 text-xs text-muted-foreground">
          {label}: paper unavailable
        </CardContent>
      </Card>
    );
  }
  return (
    <Card>
      <CardContent className="p-3 space-y-1">
        <div className="flex items-center justify-between gap-2">
          <Badge variant="outline" className="text-[10px]">
            {label}
          </Badge>
          <Link
            href={`/papers/${paper.id}`}
            className="text-[11px] text-muted-foreground inline-flex items-center gap-1 hover:text-foreground"
          >
            Open <ExternalLink className="h-3 w-3" />
          </Link>
        </div>
        <p className="text-sm font-medium leading-snug line-clamp-2">
          {paper.title ?? "Untitled paper"}
        </p>
        <p className="text-[11px] text-muted-foreground">
          {(paper.authors ?? []).slice(0, 3).join(", ") || "Unknown"}
          {paper.year ? ` (${paper.year})` : ""}
        </p>
      </CardContent>
    </Card>
  );
}

function CompareRow({
  id,
  label,
  a,
  b,
  citations,
  paperA,
  paperB,
}: {
  id: string;
  label: string;
  a: string;
  b: string;
  citations: { ref: string; chunk_id: string; paper_id: string; page_start: number | null; snippet: string }[];
  paperA: Paper | null;
  paperB: Paper | null;
}) {
  return (
    <section id={id} className="border-b last:border-0">
      <div className="px-4 pt-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{label}</h3>
        <CompareCitations citations={citations} paperA={paperA} paperB={paperB} compact />
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 px-4 py-3 text-sm leading-relaxed">
        <div className="rounded-md border bg-muted/20 p-3">{a}</div>
        <div className="rounded-md border bg-muted/20 p-3">{b}</div>
      </div>
    </section>
  );
}

function CompareCitations({
  citations,
  paperA,
  paperB,
  compact,
  className,
}: {
  citations: { ref: string; paper_id: string; page_start: number | null; snippet: string }[];
  paperA: Paper | null;
  paperB: Paper | null;
  compact?: boolean;
  className?: string;
}) {
  if (citations.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1", className)}>
      {citations.map((c) => {
        const which = c.paper_id === paperA?.id ? "A" : c.paper_id === paperB?.id ? "B" : "?";
        const href = `/papers/${c.paper_id}${c.page_start ? "" : ""}`;
        return (
          <Link
            key={c.ref}
            href={href}
            title={c.snippet}
            className={cn(
              "inline-flex items-center rounded border px-1.5 font-mono text-[10px] hover:bg-accent",
              compact ? "py-0" : "py-0.5"
            )}
          >
            {which} p.{c.page_start ?? "?"}
          </Link>
        );
      })}
    </div>
  );
}
