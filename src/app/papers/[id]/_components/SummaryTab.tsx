"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  RefreshCw,
  AlertTriangle,
  Pin,
  PinOff,
  History as HistoryIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Collapsible } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { CitationBadges } from "@/components/analyses/CitationBadges";
import { resolveStoredSummary } from "@/lib/analyses/resolve";
import type { Citation, SummaryRow } from "@/types/db";
import { cn } from "@/lib/utils";

type Props = {
  paperId: string;
  active: boolean;
  onCitationClick?: (c: Citation) => void;
};

type Section = {
  id: string;
  label: string;
};

const SECTIONS: Section[] = [
  { id: "abstract", label: "Abstract Summary" },
  { id: "methods", label: "Key Methodology" },
  { id: "findings", label: "Main Findings" },
  { id: "limitations", label: "Limitations" },
  { id: "clinical", label: "Clinical Relevance" },
  { id: "po", label: "POAR Relevance" },
  { id: "future", label: "Future Directions" },
];

type VersionItem = { id: string; version: number; pinned: boolean; archived: boolean; created_at: string };

export function SummaryTab({ paperId, active, onCitationClick }: Props) {
  const [summary, setSummary] = useState<SummaryRow | null>(null);
  const [versions, setVersions] = useState<VersionItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<string>(SECTIONS[0].id);

  // Lazy fetch on first activation.
  const [touched, setTouched] = useState(false);
  useEffect(() => {
    if (active && !touched) setTouched(true);
  }, [active, touched]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/papers/${paperId}/summary`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as { summary: SummaryRow | null; versions: VersionItem[] };
      setSummary(data.summary);
      setVersions(data.versions ?? []);
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
      const res = await fetch(`/api/papers/${paperId}/summary`, { method: "POST" });
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

  const loadVersion = async (versionId: string) => {
    try {
      const res = await fetch(`/api/summaries/${versionId}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const { summary: s } = (await res.json()) as { summary: SummaryRow };
      setSummary(s);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const togglePin = async () => {
    if (!summary) return;
    const next = !summary.pinned;
    setSummary({ ...summary, pinned: next });
    await fetch(`/api/summaries/${summary.id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ pinned: next }),
    });
  };

  const resolved = useMemo(
    () => (summary ? resolveStoredSummary(summary.payload, summary.citations) : null),
    [summary]
  );

  if (!touched) return null; // tab never opened

  return (
    <div className="grid grid-cols-1 lg:grid-cols-[180px_minmax(0,1fr)] h-full overflow-hidden">
      {/* Sticky in-tab nav */}
      <nav className="hidden lg:block border-r p-3 overflow-y-auto">
        <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2">
          Sections
        </p>
        <ul className="space-y-0.5 text-sm">
          {SECTIONS.map((s) => (
            <li key={s.id}>
              <a
                href={`#summary-${s.id}`}
                onClick={() => setActiveSection(s.id)}
                className={cn(
                  "block rounded px-2 py-1 hover:bg-accent",
                  activeSection === s.id && "bg-accent font-medium"
                )}
              >
                {s.label}
              </a>
            </li>
          ))}
        </ul>
        {versions.length > 1 && (
          <div className="mt-4">
            <p className="text-[10px] uppercase tracking-wider text-muted-foreground mb-2 flex items-center gap-1">
              <HistoryIcon className="h-3 w-3" /> Versions
            </p>
            <ul className="space-y-0.5 text-xs">
              {versions.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => loadVersion(v.id)}
                    className={cn(
                      "w-full text-left rounded px-2 py-1 hover:bg-accent",
                      summary?.id === v.id && "bg-accent font-medium"
                    )}
                  >
                    v{v.version}
                    {v.pinned && <Pin className="inline h-2.5 w-2.5 ml-1" />}
                    <span className="ml-1 text-muted-foreground">
                      {new Date(v.created_at).toLocaleDateString()}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}
      </nav>

      <div className="overflow-y-auto">
        <header className="sticky top-0 z-10 bg-background border-b px-5 py-2.5 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-sm">
            <Sparkles className="h-4 w-4 text-muted-foreground" />
            <span className="font-medium">Structured Summary</span>
            {summary && (
              <Badge variant="outline" className="font-mono text-[10px]">
                v{summary.version}
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-1">
            {summary && (
              <Button variant="ghost" size="sm" onClick={togglePin} aria-label="Pin summary">
                {summary.pinned ? <PinOff className="h-3.5 w-3.5" /> : <Pin className="h-3.5 w-3.5" />}
              </Button>
            )}
            <Button
              size="sm"
              variant={summary ? "outline" : "default"}
              onClick={generate}
              disabled={generating}
            >
              <RefreshCw className={cn("h-3.5 w-3.5 mr-1", generating && "animate-spin")} />
              {summary ? "Regenerate" : "Generate"}
            </Button>
          </div>
        </header>

        <div className="px-6 py-4">
          {loading ? (
            <SummarySkeleton />
          ) : error ? (
            <ErrorState message={error} onRetry={generate} />
          ) : !summary || !resolved ? (
            <EmptyState onGenerate={generate} />
          ) : (
            <article className="max-w-3xl space-y-1">
              <SummarySection
                id="summary-abstract"
                title="Abstract Summary"
                citations={resolved.abstract_summary.citations}
                onCitationClick={onCitationClick}
              >
                <p>{resolved.abstract_summary.text}</p>
              </SummarySection>

              <SummarySection
                id="summary-methods"
                title="Key Methodology"
                citations={resolved.key_methodology.citations}
                onCitationClick={onCitationClick}
              >
                <BulletList items={resolved.key_methodology.items} />
              </SummarySection>

              <SummarySection
                id="summary-findings"
                title="Main Findings"
                citations={resolved.main_findings.citations}
                onCitationClick={onCitationClick}
              >
                <BulletList items={resolved.main_findings.items} />
              </SummarySection>

              <SummarySection
                id="summary-limitations"
                title="Limitations"
                citations={resolved.limitations.citations}
                onCitationClick={onCitationClick}
              >
                <BulletList items={resolved.limitations.items} />
              </SummarySection>

              <SummarySection
                id="summary-clinical"
                title="Clinical Relevance"
                citations={resolved.clinical_relevance.citations}
                onCitationClick={onCitationClick}
              >
                <p>{resolved.clinical_relevance.text}</p>
              </SummarySection>

              <SummarySection
                id="summary-po"
                title="Prosthetics, Orthotics & Assistive Robotics Relevance"
                citations={resolved.po_relevance.citations}
                onCitationClick={onCitationClick}
              >
                <p>{resolved.po_relevance.text}</p>
              </SummarySection>

              <SummarySection
                id="summary-future"
                title="Future Research Directions"
                citations={resolved.future_directions.citations}
                onCitationClick={onCitationClick}
              >
                <BulletList items={resolved.future_directions.items} />
              </SummarySection>
            </article>
          )}
        </div>
      </div>
    </div>
  );
}

function SummarySection({
  id,
  title,
  citations,
  onCitationClick,
  children,
}: {
  id: string;
  title: string;
  citations: Citation[];
  onCitationClick?: (c: Citation) => void;
  children: React.ReactNode;
}) {
  return (
    <Collapsible
      id={id}
      title={title}
      trailing={
        citations.length > 0 ? (
          <span className="text-[10px] text-muted-foreground font-mono">
            {citations.length} src
          </span>
        ) : null
      }
    >
      {children}
      <CitationBadges citations={citations} onClick={onCitationClick} />
    </Collapsible>
  );
}

function BulletList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc pl-5 space-y-1">
      {items.map((s, i) => (
        <li key={i}>{s}</li>
      ))}
    </ul>
  );
}

function SummarySkeleton() {
  return (
    <div className="max-w-3xl space-y-6">
      {Array.from({ length: 4 }).map((_, i) => (
        <div key={i} className="space-y-2">
          <Skeleton className="h-4 w-1/3" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-3 w-11/12" />
          <Skeleton className="h-3 w-9/12" />
        </div>
      ))}
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="max-w-md space-y-3 text-sm">
      <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/5 p-3">
        <AlertTriangle className="h-4 w-4 mt-0.5 text-destructive shrink-0" />
        <p>
          <span className="font-medium text-destructive">Generation failed.</span>{" "}
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
        No structured summary yet. Generate one to get a section-by-section breakdown of the paper
        with citations linked back to the original PDF.
      </p>
      <Button onClick={onGenerate}>
        <Sparkles className="h-3.5 w-3.5 mr-1" /> Generate summary
      </Button>
    </div>
  );
}
