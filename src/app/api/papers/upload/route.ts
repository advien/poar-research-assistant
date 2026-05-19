import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { UploadRequestSchema, safeParse, type UploadRequest } from "@/lib/api/schemas";
import { enforceRateLimit } from "@/lib/rate-limit/edge";

// Edge runtime: this route only mints a signed Supabase Storage upload URL.
// The browser PUTs the bytes directly to Storage so the worker never has to
// stream the file body through itself.
export const runtime = "edge";

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  // Rate limit: 3 uploads/min by default. The signed URL itself is single-shot
  // so this caps how often we hand out write-credentials to Storage.
  const rl = await enforceRateLimit({ req, scope: "upload", userId: user.id });
  if (rl.limited) return rl.limited;

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    return NextResponse.json({ error: "bad_request", detail: "malformed JSON" }, { status: 400 });
  }
  const parsed = safeParse(UploadRequestSchema, payload);
  if (!parsed.ok) {
    return NextResponse.json({ error: "bad_request", detail: parsed.error }, { status: 400 });
  }
  const body: UploadRequest = parsed.data;

  // 1. Insert pending paper row to mint an id.
  const { data: paper, error: insertErr } = await supabase
    .from("papers")
    .insert({
      user_id: user.id,
      storage_path: "", // filled below
      status: "pending",
      title: body.filename.replace(/\.pdf$/i, ""),
    })
    .select("id")
    .single();

  if (insertErr || !paper) {
    return NextResponse.json(
      { error: "db_error", detail: insertErr?.message },
      { status: 500 }
    );
  }

  const storagePath = `${user.id}/${paper.id}.pdf`;

  // 2. Patch the row with the final path.
  await supabase
    .from("papers")
    .update({ storage_path: storagePath })
    .eq("id", paper.id);

  // 3. Issue a signed upload URL the browser can PUT directly to Storage.
  const { data: signed, error: signErr } = await supabase.storage
    .from("papers")
    .createSignedUploadUrl(storagePath);

  if (signErr || !signed) {
    await supabase.from("papers").delete().eq("id", paper.id);
    return NextResponse.json(
      { error: "storage_error", detail: signErr?.message },
      { status: 500 }
    );
  }

  return NextResponse.json({
    paper_id: paper.id,
    storage_path: storagePath,
    token: signed.token,
    signed_url: signed.signedUrl,
  });
}
