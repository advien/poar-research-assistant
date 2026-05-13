import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { LibraryClient } from "./_components/LibraryClient";

export const dynamic = "force-dynamic";

export default async function LibraryPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: papers } = await supabase
    .from("papers")
    .select(
      "id,title,authors,journal,year,tags,page_count,status,error,summary,created_at"
    )
    .order("created_at", { ascending: false });

  return (
    <div className="mx-auto max-w-7xl px-4 py-8 space-y-6">
      <div className="flex items-end justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">POAR Research Library</h1>
          <p className="text-sm text-muted-foreground">
            Upload prosthetics, orthotics, assistive robotics, biomechanics, and rehabilitation
            engineering papers to chat with them and search across your library.
          </p>
        </div>
        <Link href="/chat" className="text-sm underline underline-offset-4">
          Cross-library chat
        </Link>
      </div>
      <LibraryClient initialPapers={papers ?? []} />
    </div>
  );
}
