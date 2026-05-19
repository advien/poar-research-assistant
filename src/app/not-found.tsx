import Link from "next/link";
import { FileQuestion, Home } from "lucide-react";

// next-on-pages flags /_not-found as a non-static route because the root
// layout is dynamic. Declaring Edge runtime here keeps the build green; the
// component itself has no runtime logic.
export const runtime = "edge";

export default function NotFound() {
  return (
    <div className="mx-auto max-w-md px-4 py-16 text-center space-y-4">
      <div className="mx-auto inline-flex h-10 w-10 items-center justify-center rounded-full bg-muted text-muted-foreground">
        <FileQuestion className="h-5 w-5" />
      </div>
      <div>
        <h1 className="text-lg font-semibold">Page not found.</h1>
        <p className="text-sm text-muted-foreground mt-1">
          The link is broken or the resource has been deleted.
        </p>
      </div>
      <Link
        href="/library"
        className="inline-flex h-8 items-center rounded-md border px-3 text-xs font-medium hover:bg-accent"
      >
        <Home className="h-3.5 w-3.5 mr-1" /> Back to library
      </Link>
    </div>
  );
}
