import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { CATEGORY_LABELS, CATEGORY_ORDER, TAGS_BY_CATEGORY, labelFor } from "@/lib/tags";
import { CHAT_MODEL } from "@/lib/ai/anthropic";
import { EMBEDDING_DIM, EMBEDDING_MODEL } from "@/lib/ai/openai";

export const runtime = "edge";
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { count: papersCount } = await supabase
    .from("papers")
    .select("id", { count: "exact", head: true });
  const { count: chunksCount } = await supabase
    .from("chunks")
    .select("id", { count: "exact", head: true });
  const { count: chatsCount } = await supabase
    .from("chats")
    .select("id", { count: "exact", head: true })
    .eq("archived", false);
  const { count: summariesCount } = await supabase
    .from("paper_summaries")
    .select("id", { count: "exact", head: true })
    .eq("archived", false);
  const { count: terminologyCount } = await supabase
    .from("paper_terminology")
    .select("id", { count: "exact", head: true })
    .eq("archived", false);
  const { count: comparisonsCount } = await supabase
    .from("paper_comparisons")
    .select("id", { count: "exact", head: true })
    .eq("archived", false);

  const env = {
    anthropic: Boolean(process.env.ANTHROPIC_API_KEY),
    openai: Boolean(process.env.OPENAI_API_KEY),
    supabaseUrl: Boolean(process.env.NEXT_PUBLIC_SUPABASE_URL),
    serviceRole: Boolean(process.env.SUPABASE_SERVICE_ROLE_KEY),
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-8 space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Settings</h1>
        <p className="text-sm text-muted-foreground">
          Signed in as <span className="font-medium">{user.email}</span>
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Library</CardTitle>
          <CardDescription>What lives in your account.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 sm:grid-cols-3 gap-4 text-sm">
          <Stat label="Papers" value={papersCount ?? 0} />
          <Stat label="Indexed chunks" value={chunksCount ?? 0} />
          <Stat label="Active conversations" value={chatsCount ?? 0} />
          <Stat label="Saved summaries" value={summariesCount ?? 0} />
          <Stat label="Terminology sets" value={terminologyCount ?? 0} />
          <Stat label="Saved comparisons" value={comparisonsCount ?? 0} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Models</CardTitle>
          <CardDescription>Active providers and dimensions.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          <Row label="Chat" value={`${CHAT_MODEL} (Anthropic)`} />
          <Row label="Embeddings" value={`${EMBEDDING_MODEL} (${EMBEDDING_DIM} dims)`} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Environment</CardTitle>
          <CardDescription>Required keys detected on the server.</CardDescription>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-2 text-sm">
          <KeyState label="ANTHROPIC_API_KEY" ok={env.anthropic} />
          <KeyState label="OPENAI_API_KEY" ok={env.openai} />
          <KeyState label="NEXT_PUBLIC_SUPABASE_URL" ok={env.supabaseUrl} />
          <KeyState label="SUPABASE_SERVICE_ROLE_KEY" ok={env.serviceRole} />
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>POAR tag vocabulary</CardTitle>
          <CardDescription>
            Curated tags spanning prosthetics, orthotics, assistive &amp; rehabilitation robotics,
            neurorehabilitation, biomechanics, sensors / control, clinical context, and methods.
            Claude is constrained to choose from this list during metadata extraction; common
            acronyms (BCI, FES, IMU, SEA, MPC, ...) are normalised to their canonical slug.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {CATEGORY_ORDER.map((cat) => {
            const tags = TAGS_BY_CATEGORY[cat];
            if (tags.length === 0) return null;
            return (
              <section key={cat}>
                <h4 className="text-xs uppercase tracking-wider text-muted-foreground mb-2">
                  {CATEGORY_LABELS[cat]}{" "}
                  <span className="font-mono normal-case ml-1">{tags.length}</span>
                </h4>
                <div className="flex flex-wrap gap-1">
                  {tags.map((t) => (
                    <Badge
                      key={t.slug}
                      variant="secondary"
                      title={t.aliases?.length ? `aliases: ${t.aliases.join(", ")}` : undefined}
                    >
                      {labelFor(t.slug)}
                    </Badge>
                  ))}
                </div>
              </section>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: number | string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between border-b last:border-0 py-1">
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs">{value}</span>
    </div>
  );
}

function KeyState({ label, ok }: { label: string; ok: boolean }) {
  return (
    <div className="flex items-center justify-between border rounded-md px-3 py-2">
      <span className="font-mono text-xs">{label}</span>
      <Badge variant={ok ? "success" : "destructive"}>{ok ? "set" : "missing"}</Badge>
    </div>
  );
}
