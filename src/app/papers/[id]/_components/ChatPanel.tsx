"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useChat, type Message } from "ai/react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import type { Citation, PaperStatus } from "@/types/db";
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Loader2,
  Send,
  Square,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/utils";

export type InitialChatMessage = Omit<Message, "createdAt"> & {
  createdAt?: Date;
  citations?: Citation[];
};

type Props = {
  paperId: string | null;
  chatId?: string | null;
  initialMessages?: InitialChatMessage[];
  summary?: string | null;
  status?: PaperStatus;
  errorMessage?: string | null;
  onCitationClick?: (citation: Citation) => void;
  onChatCreated?: (chatId: string) => void;
  onTitleGenerated?: (chatId: string, title: string) => void;
  emptyHelp?: string;
  /** Optional banner above the messages (e.g. conversation title). */
  topBanner?: React.ReactNode;
};

/** Mirrors STATUS_COPY in the library card so the in-paper view shows the
 *  same human-friendly labels for the ingestion stages. */
const INGEST_STATUS_LABEL: Record<NonNullable<PaperStatus>, string> = {
  pending: "queued",
  parsing: "parsing PDF",
  embedding: "generating embeddings",
  summarizing: "writing summary",
  retrying: "retrying",
  ready: "ready",
  failed: "failed",
};

type CitationsAnnotation = {
  type: "citations";
  citations: Citation[];
  chat_id: string;
  is_new?: boolean;
};

type TitleAnnotation = {
  type: "title";
  chat_id: string;
  title: string;
};

type ChatAnnotation = CitationsAnnotation | TitleAnnotation;

export function ChatPanel({
  paperId,
  chatId,
  initialMessages,
  summary,
  status,
  errorMessage,
  onCitationClick,
  onChatCreated,
  onTitleGenerated,
  emptyHelp,
  topBanner,
}: Props) {
  // Stable hook id keyed on chat. Switching chats remounts useChat state cleanly.
  const hookId = chatId ?? "new";

  const seedCitations = useMemo<Citation[][]>(() => {
    return (initialMessages ?? [])
      .filter((m) => m.role === "assistant")
      .map((m) => m.citations ?? []);
  }, [initialMessages]);

  const baseMessages = useMemo<Message[]>(
    () =>
      (initialMessages ?? []).map((m) => ({
        id: m.id,
        role: m.role,
        content: m.content,
        createdAt: m.createdAt ?? new Date(),
      })),
    [initialMessages]
  );

  const {
    messages,
    input,
    setInput,
    handleSubmit,
    isLoading,
    data,
    error,
    stop,
  } = useChat({
    id: hookId,
    api: "/api/chat",
    initialMessages: baseMessages,
    body: { paper_id: paperId ?? null, chat_id: chatId ?? null },
    streamProtocol: "data",
  });

  // Annotations from the data stream (one citations item per turn, plus any title).
  const { streamCitations, latestTitle, latestNewChatId } = useMemo(() => {
    const arr: ChatAnnotation[] = ((data ?? []) as unknown[]).filter(
      (x): x is ChatAnnotation =>
        !!x &&
        typeof x === "object" &&
        "type" in (x as object) &&
        ((x as { type: string }).type === "citations" ||
          (x as { type: string }).type === "title")
    );
    const cites = arr.filter((a): a is CitationsAnnotation => a.type === "citations");
    const titles = arr.filter((a): a is TitleAnnotation => a.type === "title");
    return {
      streamCitations: cites.map((c) => c.citations),
      latestTitle: titles[titles.length - 1] ?? null,
      latestNewChatId:
        cites.find((c) => c.is_new && c.chat_id)?.chat_id ?? null,
    };
  }, [data]);

  // Defer onChatCreated until streaming is finished, otherwise the URL change
  // would unmount the streaming component mid-flight.
  const notifiedNewIdRef = useRef<string | null>(null);
  useEffect(() => {
    if (
      latestNewChatId &&
      !chatId &&
      !isLoading &&
      onChatCreated &&
      notifiedNewIdRef.current !== latestNewChatId
    ) {
      notifiedNewIdRef.current = latestNewChatId;
      onChatCreated(latestNewChatId);
    }
  }, [latestNewChatId, chatId, isLoading, onChatCreated]);

  const notifiedTitleRef = useRef<string | null>(null);
  useEffect(() => {
    if (!latestTitle || !onTitleGenerated) return;
    const sig = `${latestTitle.chat_id}:${latestTitle.title}`;
    if (notifiedTitleRef.current === sig) return;
    notifiedTitleRef.current = sig;
    onTitleGenerated(latestTitle.chat_id, latestTitle.title);
  }, [latestTitle, onTitleGenerated]);

  const scrollerRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    scrollerRef.current?.scrollTo({ top: scrollerRef.current.scrollHeight });
  }, [messages, isLoading]);

  const ready = !status || status === "ready";

  // For each assistant message in `messages`, look up its citations: first the
  // ones that came from initial DB-loaded turns, then ones from the live stream.
  function citationsForAssistantIndex(i: number): Citation[] {
    if (i < seedCitations.length) return seedCitations[i];
    return streamCitations[i - seedCitations.length] ?? [];
  }

  return (
    <div className="flex flex-col h-full">
      {topBanner}

      {summary ? <SummaryBanner summary={summary} /> : null}

      <div ref={scrollerRef} className="flex-1 overflow-auto p-4 space-y-4">
        {!ready && (
          <div className="rounded-md border border-dashed p-4 text-sm text-muted-foreground">
            {status === "failed"
              ? "Ingestion failed for this paper."
              : `Paper is still being processed (${INGEST_STATUS_LABEL[status ?? "pending"] ?? status}). Chat will be available once ingestion completes.`}
            {errorMessage ? (
              <div className="mt-2 text-destructive text-xs">{errorMessage}</div>
            ) : null}
          </div>
        )}

        {messages.length === 0 && ready && (
          <div className="text-sm text-muted-foreground">
            {emptyHelp ??
              "Ask a question about this paper. The assistant cites the exact page it pulled the answer from."}
          </div>
        )}

        {messages.map((m, idx) => {
          const assistantIdx = messages
            .slice(0, idx + 1)
            .filter((x) => x.role === "assistant").length - 1;
          const cites = m.role === "assistant" ? citationsForAssistantIndex(assistantIdx) : [];
          // Mark the assistant turn as "streaming" so we don't show a
          // grounding badge before the answer has finished landing.
          const isStreaming =
            m.role === "assistant" && isLoading && idx === messages.length - 1;
          return (
            <MessageBubble
              key={m.id}
              role={m.role as "user" | "assistant"}
              content={m.content}
              citations={cites}
              streaming={isStreaming}
              onCitationClick={onCitationClick}
            />
          );
        })}

        {isLoading && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" /> thinking...
          </div>
        )}

        {error ? <ChatErrorBanner message={error.message} /> : null}
      </div>

      <form
        onSubmit={(e) => {
          if (!input.trim() || !ready) {
            e.preventDefault();
            return;
          }
          handleSubmit(e);
        }}
        className="border-t p-3 flex items-end gap-2"
      >
        <Textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={ready ? "Ask anything..." : "Waiting for ingestion..."}
          disabled={!ready || isLoading}
          rows={2}
          className="resize-none"
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (input.trim() && ready) (e.currentTarget.form as HTMLFormElement).requestSubmit();
            }
          }}
        />
        {isLoading ? (
          <Button
            type="button"
            size="icon"
            variant="destructive"
            onClick={() => stop()}
            aria-label="Stop generation"
            title="Stop generation"
          >
            <Square className="h-4 w-4" />
          </Button>
        ) : (
          <Button type="submit" size="icon" disabled={!ready || !input.trim()}>
            <Send className="h-4 w-4" />
          </Button>
        )}
      </form>
    </div>
  );
}

function MessageBubble({
  role,
  content,
  citations,
  streaming,
  onCitationClick,
}: {
  role: "user" | "assistant";
  content: string;
  citations: Citation[];
  /** True while the AI SDK is still appending tokens to this assistant turn. */
  streaming?: boolean;
  onCitationClick?: (citation: Citation) => void;
}) {
  return (
    <div className={cn("flex flex-col gap-2", role === "user" ? "items-end" : "items-start")}>
      <div
        className={cn(
          "rounded-lg px-3 py-2 text-sm leading-relaxed max-w-[90%] whitespace-pre-wrap",
          role === "user"
            ? "bg-primary text-primary-foreground"
            : "bg-muted text-foreground"
        )}
      >
        {role === "assistant"
          ? renderWithCitations(content, citations, onCitationClick)
          : content}
      </div>
      {role === "assistant" && !streaming && (
        <GroundingBadge content={content} citations={citations} />
      )}
      {role === "assistant" && citations.length > 0 && (
        <details className="text-xs text-muted-foreground">
          <summary className="cursor-pointer select-none">{citations.length} sources</summary>
          <ul className="mt-1 space-y-1">
            {citations.map((c) => (
              <li key={c.n} className="flex items-start gap-2">
                <Badge
                  variant="outline"
                  className="cursor-pointer"
                  onClick={() => onCitationClick?.(c)}
                >
                  [{c.n}] p.{c.page_start ?? "?"}
                </Badge>
                <span className="line-clamp-2">{c.snippet}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * Surfaces the answer's grounding state at a glance:
 *  - Green "Grounded in N sources" when the answer cites at least one chunk.
 *  - Amber "No supporting context found" when retrieval was empty so the
 *    user knows the model is operating without grounding (and the system
 *    prompt has steered it toward refusal).
 *  - Amber "Cited but not referenced" when retrieval returned chunks but
 *    the model didn't actually use any [n] markers in the answer text.
 */
function GroundingBadge({
  content,
  citations,
}: {
  content: string;
  citations: Citation[];
}) {
  // Cheap inline-marker count, avoids a re-parse over the full token stream.
  const markerCount = (content.match(/\[\d+\]/g) ?? []).length;

  if (citations.length === 0) {
    return (
      <Badge variant="warning" className="gap-1 text-[10px] font-normal">
        <AlertCircle className="h-3 w-3" /> No supporting context found
      </Badge>
    );
  }
  if (markerCount === 0) {
    return (
      <Badge variant="warning" className="gap-1 text-[10px] font-normal">
        <AlertCircle className="h-3 w-3" /> Sources retrieved but not referenced
      </Badge>
    );
  }
  return (
    <Badge variant="success" className="gap-1 text-[10px] font-normal">
      <CheckCircle2 className="h-3 w-3" /> Grounded in {citations.length}{" "}
      {citations.length === 1 ? "source" : "sources"}
    </Badge>
  );
}

/**
 * Render a chat error in a user-friendly way. Detects the JSON shape returned
 * by `enforceRateLimit` (429 with `{ error: "rate_limited", ... }`) and shows
 * a calm "slow down" message. Falls back to the raw message for other errors.
 */
function ChatErrorBanner({ message }: { message: string }) {
  const parsed = (() => {
    try {
      const obj = JSON.parse(message);
      if (obj && typeof obj === "object" && obj.error === "rate_limited") {
        return obj as {
          error: "rate_limited";
          scope?: string;
          detail?: string;
          retry_after_sec?: number;
        };
      }
    } catch {
      /* not JSON */
    }
    return null;
  })();

  if (parsed) {
    return (
      <div className="rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-sm">
        <p className="font-medium text-amber-700 dark:text-amber-300">
          Rate limit reached
        </p>
        <p className="mt-1 text-xs text-amber-700/90 dark:text-amber-200/80">
          {parsed.detail ??
            `Please wait ${parsed.retry_after_sec ?? 60}s before trying again.`}
        </p>
      </div>
    );
  }

  return <p className="text-sm text-destructive">{message}</p>;
}

/** Replace [n] markers in the assistant text with clickable badges. */
function renderWithCitations(
  text: string,
  citations: Citation[],
  onCitationClick?: (citation: Citation) => void
) {
  const map = new Map(citations.map((c) => [c.n, c]));
  const parts = text.split(/(\[\d+\])/g);
  return parts.map((part, i) => {
    const m = part.match(/^\[(\d+)\]$/);
    if (!m) return <span key={i}>{part}</span>;
    const n = Number(m[1]);
    const c = map.get(n);
    if (!c) return <span key={i}>{part}</span>;
    return (
      <button
        key={i}
        type="button"
        title={`p.${c.page_start ?? "?"}`}
        onClick={() => onCitationClick?.(c)}
        className="mx-0.5 inline-flex items-center rounded bg-background px-1 text-[10px] font-semibold text-foreground border hover:bg-accent"
      >
        {n}
      </button>
    );
  });
}

/**
 * Bounded, collapsible summary banner.
 *
 * The chat panel lives inside a fixed-height flex column (the parent caps it at
 * `h-[calc(100vh-3.5rem)]`). Without an explicit height ceiling here, a long
 * summary would consume all remaining space and push the messages list and the
 * composer out of the viewport - the user couldn't even scroll to recover.
 *
 * Defaults: collapsed at ~5 lines (~6.5rem). Expanded view caps at 14rem with
 * its own internal scrollbar so the panel layout stays predictable on every
 * viewport size.
 */
function SummaryBanner({ summary }: { summary: string }) {
  const COLLAPSED_TRIGGER_CHARS = 280;
  const isLong = summary.length > COLLAPSED_TRIGGER_CHARS;
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border-b bg-muted/30 px-4 pt-3 pb-2 shrink-0">
      <p className="text-xs uppercase tracking-wider text-muted-foreground mb-1 flex items-center gap-1">
        <Sparkles className="h-3 w-3" /> Summary
      </p>
      <div
        className={cn(
          "text-sm leading-relaxed",
          isLong && !expanded && "line-clamp-4",
          isLong && expanded && "max-h-56 overflow-y-auto pr-1"
        )}
      >
        {summary}
      </div>
      {isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
          aria-expanded={expanded}
        >
          {expanded ? (
            <>
              <ChevronUp className="h-3 w-3" /> Show less
            </>
          ) : (
            <>
              <ChevronDown className="h-3 w-3" /> Show more
            </>
          )}
        </button>
      )}
    </div>
  );
}
