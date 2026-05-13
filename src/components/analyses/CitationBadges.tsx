"use client";

import { Badge } from "@/components/ui/badge";
import type { Citation } from "@/types/db";
import { cn } from "@/lib/utils";

type Props = {
  citations: Citation[];
  onClick?: (citation: Citation) => void;
  className?: string;
};

/** Inline pill row of citations rendered after a section/finding/term. */
export function CitationBadges({ citations, onClick, className }: Props) {
  if (!citations || citations.length === 0) return null;
  return (
    <div className={cn("flex flex-wrap gap-1 mt-1.5", className)}>
      {citations.map((c) => (
        <button
          key={c.chunk_id}
          type="button"
          title={c.snippet}
          onClick={() => onClick?.(c)}
          disabled={!onClick}
          className="inline-flex"
        >
          <Badge
            variant="outline"
            className={cn(
              "font-mono text-[10px] px-1.5 py-0 cursor-pointer hover:bg-accent",
              !onClick && "cursor-default opacity-80"
            )}
          >
            p.{c.page_start ?? "?"}
          </Badge>
        </button>
      ))}
    </div>
  );
}
