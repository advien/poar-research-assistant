"use client";

import { useEffect } from "react";
import Link from "next/link";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function PaperError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      console.error("[POAR] paper view error", error);
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <h1 className="text-lg font-semibold">This paper could not be opened.</h1>
      <p className="text-sm text-muted-foreground">
        Possible causes: the paper was deleted, the PDF signed URL expired, or ingestion was
        interrupted. Try again, or return to your library.
      </p>
      {error.digest ? (
        <p className="text-[10px] text-muted-foreground font-mono">digest {error.digest}</p>
      ) : null}
      <div className="flex justify-center gap-2">
        <Button onClick={reset} size="sm">
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Try again
        </Button>
        <Link
          href="/library"
          className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
        >
          Back to library
        </Link>
      </div>
    </div>
  );
}
