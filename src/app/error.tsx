"use client";

import { useEffect } from "react";
import { AlertTriangle, RefreshCw, Home } from "lucide-react";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function RouteError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    if (typeof window !== "undefined") {
      console.error("[POAR] route error", error);
    }
  }, [error]);

  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-destructive/10 text-destructive">
        <AlertTriangle className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">Something went wrong on this page.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The error has been logged. Try again, or head back to your library.
        </p>
        {error.digest ? (
          <p className="mt-2 text-[10px] text-muted-foreground font-mono">digest {error.digest}</p>
        ) : null}
      </div>
      <div className="flex justify-center gap-2">
        <Button onClick={reset} size="sm">
          <RefreshCw className="h-3.5 w-3.5 mr-1" /> Try again
        </Button>
        <Link
          href="/library"
          className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
        >
          <Home className="h-3.5 w-3.5 mr-1" /> Back to library
        </Link>
      </div>
    </div>
  );
}
