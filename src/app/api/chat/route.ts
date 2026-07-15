import { createDataStreamResponse, streamText, type CoreMessage } from "ai";
import { chatModel, CHAT_MODEL } from "@/lib/ai/anthropic";
import { embedQuery } from "@/lib/ai/openai";
import { RAG_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import { fallbackTitle, generateChatTitle } from "@/lib/ai/title";
import { createClient } from "@/lib/supabase/server";
import { ChatRequestSchema, safeParse, type ChatRequest } from "@/lib/api/schemas";
import { retrieveContext, type MatchedChunk } from "@/lib/rag/retrieve";
import { enforceRateLimit } from "@/lib/rate-limit/edge";
import { classifyError, createRequestLogger, startTimer } from "@/lib/observability/logger";
import { writeTrace } from "@/lib/observability/trace";

// Runs on the Cloudflare Worker (Node-compat) bundle produced by
// @opennextjs/cloudflare. Every external call (Anthropic, OpenAI, Supabase)
// is fetch-based and works under the `nodejs_compat` Workers flag.

/** Per-answer output-token cap. Tunable via env to control cost / latency. */
const DEFAULT_CHAT_MAX_OUTPUT_TOKENS = 2048;
function chatMaxOutputTokens(): number {
  const raw = process.env.CHAT_MAX_OUTPUT_TOKENS;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_CHAT_MAX_OUTPUT_TOKENS;
}

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

  // Declared in POST scope so onFinish closure can read them for trace.
  let retrievedChunks: MatchedChunk[] = [];
  let retrievalEmpty = false;
  let retrievalLatencyMs = 0;

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
    retrievedChunks = ret.chunks;
    retrievalEmpty = ret.empty;
    retrievalLatencyMs = retrievalTimer.ms();
    chatLog.info("rag.retrieve.done", {
      retrieved_chunks: ret.chunks.length,
      retrieved_chunk_ids: ret.chunks.map((c) => c.id),
      empty: ret.empty,
      latency_ms: retrievalLatencyMs,
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
  // 3. Persist user turn before streaming the assistant turn. Keep the id so
  // a failed generation can remove it again — otherwise the chat history
  // accumulates question turns with no answer.
  // -------------------------------------------------------------------------
  const { data: userMsg } = await supabase
    .from("messages")
    .insert({
      chat_id: chatId,
      user_id: user.id,
      role: "user",
      content: lastUser.content,
      citations: [],
    })
    .select("id")
    .single();

  return createDataStreamResponse({
    execute: (writer) => {
      writer.writeData({ type: "citations", citations, chat_id: chatId, is_new: isNew });

      const genTimer = startTimer();
      const result = streamText({
        model: chatModel,
        system: systemPrompt,
        messages,
        temperature: 0.2,
        // Bound the per-answer cost. Defaults to 2048 tokens; override per
        // environment with CHAT_MAX_OUTPUT_TOKENS. Caps abusive prompt
        // injections that try to make the model emit megabytes of output.
        maxTokens: chatMaxOutputTokens(),
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

          // ---------------------------------------------------------------
          // 4. Write RAG trace (fire-and-forget, never throws)
          // ---------------------------------------------------------------
          await writeTrace(supabase, chatLog, {
            requestId: log.context.request_id as string,
            userId: user.id,
            chatId,
            paperId: body.paper_id ?? null,
            query: lastUser.content,
            model: CHAT_MODEL,

            retrievalLatencyMs,
            chunks: retrievedChunks,
            retrievalEmpty,

            generationLatencyMs: genTimer.ms(),
            totalLatencyMs: totalTimer.ms(),
            inputTokens: usage?.promptTokens ?? null,
            outputTokens: usage?.completionTokens ?? null,
            finishReason,
            citationsCount: citations.length,
            answerText: text,
          });
        },
      });

      result.mergeIntoDataStream(writer);
    },
    onError(err) {
      const cls = classifyError(err);
      chatLog.error("chat.generation.failed", cls);
      // Best-effort: remove the user turn persisted above so the history has
      // no unanswered question stranded in it. Fire-and-forget — onError must
      // return the client-facing message synchronously.
      if (userMsg?.id) {
        void supabase
          .from("messages")
          .delete()
          .eq("id", userMsg.id)
          .then(({ error }) => {
            if (error) chatLog.warn("chat.orphan_cleanup_failed", { message: error.message });
          });
      }
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