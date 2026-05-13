import { NextResponse } from "next/server";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import type { ChatListItem, ChatListPage } from "@/types/db";
import { decodeCursor, encodeCursor } from "@/lib/chats/cursor";

export const dynamic = "force-dynamic";

const Query = z.object({
  q: z.string().trim().max(200).optional(),
  paper_id: z.string().uuid().optional(),
  archived: z.enum(["true", "false"]).optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
  cursor: z.string().optional(),
});

const SIDEBAR_SELECT =
  "id,paper_id,title,archived,pinned,message_count,last_message_at,created_at,updated_at";

export async function GET(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const url = new URL(req.url);
  const parsed = Query.safeParse(Object.fromEntries(url.searchParams));
  if (!parsed.success) {
    return NextResponse.json({ error: "bad_request", detail: parsed.error.format() }, { status: 400 });
  }

  const { q, paper_id, archived, limit = 30, cursor } = parsed.data;
  const includeArchived = archived === "true";

  // -------------------------------------------------------------------------
  // Search path: rank-fused title + message FTS via RPC
  // -------------------------------------------------------------------------
  if (q && q.length > 0) {
    const { data, error } = await supabase.rpc("search_chats", {
      q,
      filter_paper_id: paper_id ?? null,
      include_archived: includeArchived,
      match_count: limit,
    });
    if (error) {
      console.error("[/api/chats] search_chats RPC failed:", error);
      return NextResponse.json({ error: error.message, hint: "Did you apply migration 0004_chat_history.sql?" }, { status: 500 });
    }

    const items = (data ?? []).map(stripRank);
    const hydrated = await hydratePapers(supabase, items);

    const page: ChatListPage = {
      pinned: hydrated.filter((c) => c.pinned),
      items: hydrated.filter((c) => !c.pinned),
      next_cursor: null,
    };
    return NextResponse.json(page);
  }

  // -------------------------------------------------------------------------
  // Normal listing: pinned (always all) + cursor-paginated unpinned
  // -------------------------------------------------------------------------
  let pinned: ChatListItem[] = [];
  if (!cursor) {
    const { data: pinnedRows, error: pinErr } = await supabase
      .from("chats")
      .select(SIDEBAR_SELECT)
      .eq("pinned", true)
      .eq("archived", includeArchived ? true : false)
      .order("last_message_at", { ascending: false, nullsFirst: false })
      .order("id", { ascending: false });
    if (pinErr) {
      console.error("[/api/chats] pinned select failed:", pinErr);
      return NextResponse.json(
        { error: pinErr.message, hint: "Did you apply migration 0004_chat_history.sql? It adds the pinned/archived/last_message_at columns." },
        { status: 500 }
      );
    }
    pinned = await hydratePapers(supabase, pinnedRows ?? []);
    if (paper_id) pinned = pinned.filter((c) => c.paper_id === paper_id);
  }

  let query = supabase
    .from("chats")
    .select(SIDEBAR_SELECT)
    .eq("pinned", false)
    .eq("archived", includeArchived ? true : false);

  if (paper_id) query = query.eq("paper_id", paper_id);

  const decoded = decodeCursor(cursor);
  if (decoded) {
    // Keyset pagination: (last_message_at, id) strictly less than cursor.
    query = query.or(
      `last_message_at.lt.${decoded.last_message_at},and(last_message_at.eq.${decoded.last_message_at},id.lt.${decoded.id})`
    );
  }

  const { data: rows, error } = await query
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .order("id", { ascending: false })
    .limit(limit + 1);
  if (error) {
    console.error("[/api/chats] unpinned select failed:", error);
    return NextResponse.json(
      { error: error.message, hint: "Did you apply migration 0004_chat_history.sql?" },
      { status: 500 }
    );
  }

  const hasMore = (rows?.length ?? 0) > limit;
  const trimmed = (rows ?? []).slice(0, limit);
  const items = await hydratePapers(supabase, trimmed);

  const last = trimmed[trimmed.length - 1];
  const next_cursor =
    hasMore && last?.last_message_at
      ? encodeCursor({ last_message_at: last.last_message_at, id: last.id })
      : null;

  const page: ChatListPage = { pinned, items, next_cursor };
  return NextResponse.json(page);
}

// =============================================================================
// helpers
// =============================================================================

type Row = {
  id: string;
  paper_id: string | null;
  title: string | null;
  archived: boolean;
  pinned: boolean;
  message_count: number;
  last_message_at: string | null;
  created_at: string;
  updated_at: string;
};

function stripRank(row: Row & { rank?: number }): Row {
  const { rank: _r, ...rest } = row;
  void _r;
  return rest;
}

async function hydratePapers(
  supabase: Awaited<ReturnType<typeof createClient>>,
  rows: Row[]
): Promise<ChatListItem[]> {
  const paperIds = Array.from(new Set(rows.map((r) => r.paper_id).filter((x): x is string => !!x)));
  if (paperIds.length === 0) return rows.map((r) => ({ ...r, paper: null }));

  const { data: papers } = await supabase
    .from("papers")
    .select("id,title")
    .in("id", paperIds);
  const byId = new Map((papers ?? []).map((p) => [p.id, p]));

  return rows.map((r) => ({ ...r, paper: r.paper_id ? byId.get(r.paper_id) ?? null : null }));
}
