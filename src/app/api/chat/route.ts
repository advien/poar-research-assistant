import { createDataStreamResponse, streamText, type CoreMessage } from "ai";
import { chatModel, CHAT_MODEL } from "@/lib/ai/anthropic";
import { embedQuery } from "@/lib/ai/openai";
import { RAG_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { fallbackTitle, generateChatTitle } from "@/lib/ai/title";
import { createClient } from "@/lib/supabase/server";
import { ChatRequestSchema, safeParse, type ChatRequest } from "@/lib/api/schemas";
import { retrieveContext } from "@/lib/rag/retrieve";
import { enforceRateLimit } from "@/lib/rate-limit/edge";
import { classifyError, createRequestLogger, startTimer } from "@/lib/observability/logger";

// Cloudflare Pages / Workers requires Edge Runtime for non-static App Router
// routes. The Anthropic chat call (via @ai-sdk/anthropic), the OpenAI embedding
// call (via the openai SDK), and the Supabase clients all use fetch under the
// hood and run cleanly on Edge / Workers.
export const runtime = "edge";
export const maxDuration = 60;

export async function POST(req: Request) {
  const log = createRequestLogger({ route: "/api/chat" });
  const totalTimer = startTimer();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    log.warn("auth.unauthorized");
    return new Response("unauthorized", { status: 401 });
  }
  const userLog = log.child({ user_id: user.id });

  // Rate limit: protects the most expensive endpoint in the app (Claude
  // streaming). Default 10 / min / user; tunable via RATE_LIMIT_CHAT_PER_MIN.
  const rl = await enforceRateLimit({ req, scope: "chat", userId: user.id });
  if (rl.limited) {
    userLog.warn("ratelimit.blocked", {
      scope: "chat",
      retry_after_sec: rl.result.retryAfterSec,
    });
    return rl.limited;
  }

  let payload: unknown;
  try {
    payload = await req.json();
  } catch {
    userLog.warn("request.malformed_json");
    return new Response("malformed JSON", { status: 400 });
  }
  const parsed = safeParse(ChatRequestSchema, payload);
  if (!parsed.ok) {
    userLog.warn("request.validation_failed", { detail: parsed.error });
    return new Response(`bad request: ${parsed.error}`, { status: 400 });
  }
  const body: ChatRequest = parsed.data;

  const lastUser = [...body.messages].reverse().find((m) => m.role === "user");
  if (!lastUser) {
    userLog.warn("request.no_user_message");
    return new Response("no user message", { status: 400 });
  }

  // -------------------------------------------------------------------------
  // 1. Resolve / create the chat row
  // -------------------------------------------------------------------------
  const { chatId, isNew, paperTitle } = await ensureChat(supabase, {
    chat_id: body.chat_id ?? null,
    user_id: user.id,
    paper_id: body.paper_id ?? null,
    firstUserMessage: lastUser.content,
  });
  const chatLog = userLog.child({ chat_id: chatId, paper_id: body.paper_id ?? null });

  // -------------------------------------------------------------------------
  // 2. Retrieval (RAG) - embed query, hit match_chunks RPC under RLS
  // -------------------------------------------------------------------------
  let citations, contextBlock;
  const retrievalTimer = startTimer();
  try {
    const ret = await retrieveContext({
      supabase,
      query: lastUser.content,
      paperId: body.paper_id ?? null,
      embedder: embedQuery,
    });
    citations = ret.citations;
    contextBlock = ret.contextBlock;
    chatLog.info("rag.retrieve.done", {
      retrieved_chunks: ret.chunks.length,
      retrieved_chunk_ids: ret.chunks.map((c) => c.id),
      empty: ret.empty,
      latency_ms: retrievalTimer.ms(),
    });
  } catch (e) {
    const cls = classifyError(e);
    chatLog.error("rag.retrieve.failed", { ...cls, latency_ms: retrievalTimer.ms() });
    return new Response(cls.message, { status: 500 });
  }

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

      const genTimer = startTimer();
      const result = streamText({
        model: chatModel,
        system: systemPrompt,
        messages,
        temperature: 0.2,
        async onFinish({ text, usage, finishReason }) {
          await supabase.from("messages").insert({
            chat_id: chatId,
            user_id: user.id,
            role: "assistant",
            content: text,
            citations: citations as unknown as never,
          });

          chatLog.info("chat.generation.done", {
            model: CHAT_MODEL,
            finish_reason: finishReason,
            latency_ms: genTimer.ms(),
            total_latency_ms: totalTimer.ms(),
            token_usage: usage
              ? {
                  prompt: usage.promptTokens,
                  completion: usage.completionTokens,
                  total: usage.totalTokens,
                }
              : null,
            citations_count: citations.length,
            is_new_chat: isNew,
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
      const cls = classifyError(err);
      chatLog.error("chat.generation.failed", cls);
      return cls.message;
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
