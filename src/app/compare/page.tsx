import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ComparePicker } from "./_components/ComparePicker";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function ComparePage({
  searchParams,
}: {
  searchParams: Promise<{ a?: string; b?: string }>;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const sp = await searchParams;

  const { data: papers } = await supabase
    .from("papers")
    .select("id,title,authors,year,status")
    .eq("status", "ready")
    .order("created_at", { ascending: false });

  const { data: existing } = await supabase
    .from("paper_comparisons")
    .select(
      "id,paper_a_id,paper_b_id,similarity_score,stronger_paper,contradiction_count,title,pinned,created_at"
    )
    .eq("archived", false)
    .order("pinned", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(15);

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Compare papers</h1>
        <p className="text-sm text-muted-foreground">
          Pick two ingested papers to generate a structured side-by-side analysis with similarity
          scoring, contradiction detection, and a verdict on which paper is methodologically
          stronger.
        </p>
      </div>
      <ComparePicker
        papers={papers ?? []}
        recent={existing ?? []}
        defaultA={sp.a ?? null}
        defaultB={sp.b ?? null}
      />
    </div>
  );
}
