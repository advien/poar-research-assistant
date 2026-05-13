import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { HistoryClient } from "./_components/HistoryClient";

export const dynamic = "force-dynamic";

export default async function HistoryPage({
  searchParams,
}: {
  searchParams: Promise<{ kind?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;
  const initialKind = (["summary", "terminology", "comparison"] as const).includes(
    sp.kind as never
  )
    ? (sp.kind as "summary" | "terminology" | "comparison")
    : "all";

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 space-y-4">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Saved analyses</h1>
        <p className="text-sm text-muted-foreground">
          Every structured summary, terminology extraction, and paper comparison you generate is
          saved here. Pin the ones you reference often, archive the rest.
        </p>
      </div>
      <HistoryClient initialKind={initialKind} />
    </div>
  );
}
