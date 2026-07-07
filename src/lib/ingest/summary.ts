import { generateText } from "ai";
import { chatModel } from "@/lib/ai/anthropic";
import { aiTimeoutSignal } from "@/lib/ai/timeout";
import { SUMMARY_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import type { ParsedPage } from "./parsePdf";

export async function summarisePaper(
  pages: ParsedPage[],
  meta: { title?: string | null; abstract?: string | null }
): Promise<string> {
  // Cap input at ~30k chars: take front-loaded content (intro + methods + results).
  const body = pages
    .map((p) => p.text)
    .join("\n\n")
    .slice(0, 30000);

  const { text } = await generateText({
    model: chatModel,
    abortSignal: aiTimeoutSignal(),
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: `Title: ${meta.title ?? "Unknown"}
Abstract: ${meta.abstract ?? "n/a"}

Full text (truncated):
${body}

Write the summary now. ~250 words, plain prose, no headings.`,
  });

  return text.trim();
}
