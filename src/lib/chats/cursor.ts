/**
 * Opaque cursor for keyset pagination ordered by (last_message_at desc, id desc).
 * Encoded as base64url to keep URLs and request bodies tidy.
 *
 * Implementation note: we deliberately use the standard Web `btoa` / `atob`
 * APIs instead of `Buffer` so this module is portable across the Edge runtime,
 * Cloudflare Workers (with or without `nodejs_compat`), and Node. The cursor
 * payload is short ASCII JSON so a UTF-16 surrogate is impossible.
 */
export type ChatCursor = { last_message_at: string; id: string };

export function encodeCursor(c: ChatCursor): string {
  return base64urlEncode(JSON.stringify(c));
}

export function decodeCursor(raw: string | null | undefined): ChatCursor | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(base64urlDecode(raw)) as ChatCursor;
    if (typeof parsed.last_message_at === "string" && typeof parsed.id === "string") {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

function base64urlEncode(input: string): string {
  const b64 = btoa(input);
  return b64.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64urlDecode(input: string): string {
  const b64 = input.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return atob(padded);
}
