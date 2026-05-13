import { createAnthropic } from "@ai-sdk/anthropic";

export const CHAT_MODEL = "claude-sonnet-4-5";

export const anthropic = createAnthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const chatModel = anthropic(CHAT_MODEL);
