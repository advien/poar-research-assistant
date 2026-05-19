import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ComparisonView } from "../_components/ComparisonView";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function ComparisonPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: comparison } = await supabase
    .from("paper_comparisons")
    .select(
      "id,user_id,paper_a_id,paper_b_id,version,payload,citations,similarity_score,stronger_paper,contradiction_count,title,pinned,archived,model,prompt_version,created_at,updated_at"
    )
    .eq("id", id)
    .single();
  if (!comparison) notFound();

  const { data: papers } = await supabase
    .from("papers")
    .select("id,title,authors,year")
    .in("id", [comparison.paper_a_id, comparison.paper_b_id]);
  const byId = new Map((papers ?? []).map((p) => [p.id, p]));
  const paperA = byId.get(comparison.paper_a_id) ?? null;
  const paperB = byId.get(comparison.paper_b_id) ?? null;

  return (
    <div className="mx-auto max-w-7xl px-4 py-6 space-y-4">
      <nav className="text-sm text-muted-foreground">
        <Link href="/compare" className="underline underline-offset-4">
          Compare
        </Link>{" "}
        / {comparison.title ?? `v${comparison.version}`}
      </nav>
      <ComparisonView
        comparison={comparison}
        paperA={paperA}
        paperB={paperB}
      />
    </div>
  );
}
