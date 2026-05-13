/**
 * Opaque cursor for keyset pagination ordered by (last_message_at desc, id desc).
 * Encoded as base64url to keep URLs and request bodies tidy.
 */
export type ChatCursor = { last_message_at: string; id: string };

export function encodeCursor(c: ChatCursor): string {
  return Buffer.from(JSON.stringify(c)).toString("base64url");
}

export function decodeCursor(raw: string | null | undefined): ChatCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(Buffer.from(raw, "base64url").toString("utf8")) as ChatCursor;
    if (typeof parsed.last_message_at === "string" && typeof parsed.id === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}
