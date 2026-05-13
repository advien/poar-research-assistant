import { z } from "zod";
import { createDataStreamResponse, streamText, type CoreMessage } from "ai";
import { chatModel } from "@/lib/ai/anthropic";
import { embedQuery } from "@/lib/ai/openai";
import { RAG_SYSTEM_PROMPT, buildContextBlock } from "@/lib/ai/prompts";
import { fallbackTitle, generateChatTitle } from "@/lib/ai/title";
import { createClient } from "@/lib/supabase/server";
import type { Citation } from "@/types/db";

export const runtime = "nodejs";
export const maxDuration = 60;

const Body = z.object({
  messages: z.array(
    z.object({
      role: z.enum(["user", "assistant", "system"]),
      content: z.string(),
    })
  ),
  paper_id: z.string().uuid().nullable().optional(),
  chat_id: z.string().uuid().nullable().optional(),
});

export async function POST(req: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Response("unauthorized", { status: 401 });

  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (e) {
    return new Response(`bad request: ${String(e)}`, { status: 400 });
  }

  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) return new Response("no user message", { status: 400 });

  // -------------------------------------------------------------------------
  // 1. Resolve / create the chat row
  // -------------------------------------------------------------------------
  const { chatId, isNew, paperTitle } = await ensureChat(supabase, {
    chat_id: body.chat_id ?? null,
    user_id: user.id,
    paper_id: body.paper_id ?? null,
    firstUserMessage: lastUser.content,
  });

  // -------------------------------------------------------------------------
  // 2. Retrieval (RAG) - embed query, hit match_chunks RPC under RLS
  // -------------------------------------------------------------------------
  const k = body.paper_id ? 8 : 12;
  const queryEmbedding = await embedQuery(lastUser.content);

  const { data: matches, error: rpcErr } = await supabase.rpc("match_chunks", {
    query_embedding: queryEmbedding,
    match_count: k,
    filter_paper_id: body.paper_id ?? null,
  });
  if (rpcErr) return new Response(`retrieval failed: ${rpcErr.message}`, { status: 500 });

  const chunks = matches ?? [];

  const citations: Citation[] = chunks.map((c, i) => ({
    n: i + 1,
    chunk_id: c.id,
    paper_id: c.paper_id,
    page_start: c.page_start,
    page_end: c.page_end,
    snippet: c.content.slice(0, 240),
  }));

  const contextBlock = chunks.length
    ? buildContextBlock(chunks)
    : "(no relevant chunks were retrieved from the user's library)";

  const systemPrompt = `${RAG_SYSTEM_PROMPT}\n\n# Retrieved context\n\n${contextBlock}`;

  const messages: CoreMessage[] = body.messages.map((m) => ({
    role: m.role,
    content: m.content,
  }));

  // -------------------------------------------------------------------------
  // 3. Persist user turn before streaming the assistant turn
  // -------------------------------------------------------------------------
  await supabase.from("messages").insert({
    chat_id: chatId,
    user_id: user.id,
    role: "user",
    content: lastUser.content,
    citations: [],
  });

  return createDataStreamResponse({
    execute: (writer) => {
      writer.writeData({ type: "citations", citations, chat_id: chatId, is_new: isNew });

      const result = streamText({
        model: chatModel,
        system: systemPrompt,
        messages,
        temperature: 0.2,
        async onFinish({ text }) {
          await supabase.from("messages").insert({
            chat_id: chatId,
            user_id: user.id,
            role: "assistant",
            content: text,
            citations: citations as unknown as never,
          });

          // First turn: replace the placeholder title with a Claude-written one.
          if (isNew) {
            const title = await generateChatTitle({
              userMessage: lastUser.content,
              assistantMessage: text,
              paperTitle,
            });
            await supabase.from("chats").update({ title }).eq("id", chatId);
            writer.writeData({ type: "title", chat_id: chatId, title });
          }
        },
      });

      result.mergeIntoDataStream(writer);
    },
    onError(err) {
      return err instanceof Error ? err.message : String(err);
    },
  });
}

// =============================================================================
// helpers
// =============================================================================

async function ensureChat(
  supabase: Awaited<ReturnType<typeof createClient>>,
  args: {
    chat_id: string | null;
    user_id: string;
    paper_id: string | null;
    firstUserMessage: string;
  }
): Promise<{ chatId: string; isNew: boolean; paperTitle: string | null }> {
  let paperTitle: string | null = null;
  if (args.paper_id) {
    const { data: p } = await supabase
      .from("papers")
      .select("title")
      .eq("id", args.paper_id)
      .single();
    paperTitle = p?.title ?? null;
  }

  if (args.chat_id) {
    const { data } = await supabase
      .from("chats")
      .select("id")
      .eq("id", args.chat_id)
      .single();
    if (data) return { chatId: data.id, isNew: false, paperTitle };
  }

  const { data, error } = await supabase
    .from("chats")
    .insert({
      user_id: args.user_id,
      paper_id: args.paper_id,
      title: fallbackTitle(args.firstUserMessage),
    })
    .select("id")
    .single();
  if (error || !data) throw new Error(error?.message ?? "chat insert failed");
  return { chatId: data.id, isNew: true, paperTitle };
}
