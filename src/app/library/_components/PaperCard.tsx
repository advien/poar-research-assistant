"use client";

import Link from "next/link";
import { Card, CardContent, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { PaperRow } from "@/types/db";
import { Trash2, FileText, AlertTriangle, Loader2, CheckCircle2, MessageSquare } from "lucide-react";
import { truncate } from "@/lib/utils";

type ListItem = Pick<
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

export function PaperCard({
  paper,
  onDelete,
}: {
  paper: ListItem;
  onDelete: (id: string) => void;
}) {
  return (
    <Card className="flex flex-col">
      <CardHeader className="space-y-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base leading-snug">
            <Link href={`/papers/${paper.id}`} className="hover:underline">
              {truncate(paper.title || "Untitled", 110)}
            </Link>
          </CardTitle>
          <StatusBadge status={paper.status} />
        </div>
        <p className="text-xs text-muted-foreground">
          {paper.authors?.length ? truncate(paper.authors.join(", "), 80) : "Unknown authors"}
          {paper.year ? ` (${paper.year})` : ""}
          {paper.journal ? ` - ${truncate(paper.journal, 40)}` : ""}
        </p>
      </CardHeader>
      <CardContent className="text-sm text-muted-foreground flex-1">
        {paper.status === "failed" ? (
          <p className="text-destructive">{paper.error ?? "Ingestion failed"}</p>
        ) : paper.summary ? (
          truncate(paper.summary, 220)
        ) : (
          <span className="italic">Summary will appear once ingestion completes.</span>
        )}
      </CardContent>
      <CardFooter className="justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {(paper.tags ?? []).slice(0, 3).map((t) => (
            <Badge key={t} variant="secondary">
              {t}
            </Badge>
          ))}
          {paper.page_count ? (
            <Badge variant="outline" className="font-normal">
              <FileText className="h-3 w-3 mr-1" />
              {paper.page_count}p
            </Badge>
          ) : null}
        </div>
        <div className="flex items-center gap-1">
          {paper.status === "ready" && (
            <Link
              href={`/papers/${paper.id}`}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md hover:bg-accent"
              aria-label="Open paper chat"
            >
              <MessageSquare className="h-4 w-4" />
            </Link>
          )}
          <Button
            variant="ghost"
            size="icon"
            aria-label="Delete paper"
            onClick={() => onDelete(paper.id)}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </CardFooter>
    </Card>
  );
}

/**
 * User-facing copy for each ingestion stage. Keeps the raw enum values in
 * the DB (and in logs) but maps them to descriptive verbs the user can
 * actually parse without knowing the pipeline internals.
 */
const STATUS_COPY: Record<ListItem["status"], string> = {
  pending: "Queued",
  parsing: "Parsing PDF...",
  embedding: "Generating embeddings...",
  summarizing: "Writing summary...",
  retrying: "Retrying...",
  ready: "Ready",
  failed: "Failed",
};

function StatusBadge({ status }: { status: ListItem["status"] }) {
  const label = STATUS_COPY[status] ?? status;
  switch (status) {
    case "ready":
      return (
        <Badge variant="success" className="gap-1">
          <CheckCircle2 className="h-3 w-3" /> {label}
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> {label}
        </Badge>
      );
    case "retrying":
      return (
        <Badge variant="warning" className="gap-1">
          <AlertTriangle className="h-3 w-3" /> {label}
        </Badge>
      );
    case "pending":
    case "parsing":
    case "embedding":
    case "summarizing":
    default:
      return (
        <Badge variant="warning" className="gap-1">
          <Loader2 className="h-3 w-3 animate-spin" /> {label}
        </Badge>
      );
  }
}
