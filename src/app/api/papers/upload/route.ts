import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const Body = z.object({
  filename: z.string().min(1).max(256),
  size: z.number().int().positive().max(100 * 1024 * 1024),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return NextResponse.json({ error: "bad_request", detail: String(e) }, { status: 400 });
  }

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
