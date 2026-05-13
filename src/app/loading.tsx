import { Loader2 } from "lucide-react";

export default function Loading() {
  return (
    <div className="grid min-h-[40vh] place-items-center text-sm text-muted-foreground">
      <span className="inline-flex items-center gap-2">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading...
      </span>
    </div>
  );
}
