import { generateText } from "ai";
import { chatModel } from "./anthropic";

const TITLE_SYSTEM = `You write extremely short, descriptive titles for research-assistant chats
about prosthetics, orthotics, and assistive / rehabilitation robotics literature. Reply with
ONLY the title text, no quotes, no markdown, no trailing punctuation. 4-8 words. Sentence case.
Concrete, not generic.

Bad: "Question about a paper", "Research discussion"
Good: "Outcome measures in wrist orthosis trials", "EMG vs body-powered grasp force",
      "Soft exosuit metabolic cost reduction", "Powered prosthetic ankle gait symmetry"`;

const FALLBACK_MAX = 80;

/** Heuristic fallback - first sentence/clause of the user's prompt. */
export function fallbackTitle(userMessage: string): string {
  const cleaned = userMessage.replace(/\s+/g, " ").trim();
  const cut = cleaned.split(/[.?!\n]/)[0] ?? cleaned;
  return cut.slice(0, FALLBACK_MAX);
}

export async function generateChatTitle(args: {
  userMessage: string;
  assistantMessage: string;
  paperTitle?: string | null;
}): Promise<string> {
  try {
    const ctx = args.paperTitle ? `Paper context: "${args.paperTitle}"\n\n` : "";
    const { text } = await generateText({
      model: chatModel,
      system: TITLE_SYSTEM,
      prompt: `${ctx}User asked:\n${args.userMessage.slice(0, 600)}\n\nAssistant answered:\n${args.assistantMessage.slice(0, 800)}\n\nGive me the title.`,
      temperature: 0.2,
      maxTokens: 30,
    });
    const cleaned = text
      .replace(/^["'`*]+|["'`*]+$/g, "")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, FALLBACK_MAX);
    return cleaned || fallbackTitle(args.userMessage);
  } catch {
    return fallbackTitle(args.userMessage);
  }
}
