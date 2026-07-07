import { aiTimeoutSignal } from "./timeout";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

// We call the embeddings endpoint over plain `fetch` rather than the `openai`
// Node SDK on purpose. Under @opennextjs/cloudflare the runtime advertises
// `nodejs_compat`, so the SDK picks its Node transport (node:https), but unenv
// only stubs `https.request` ("[unenv] https.request is not implemented yet!").
// `fetch` is implemented natively by the Workers runtime, so the request
// actually goes out. This also keeps query-time embedding (search / chat)
// working, which used the same SDK path.
const OPENAI_BASE_URL = (process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(
  /\/$/,
  ""
);

type EmbeddingResponse = {
  data: Array<{ index: number; embedding: number[] }>;
};

/** Embed a batch of strings. OpenAI accepts up to 2048 inputs per request. */
export async function embedBatch(input: string[]): Promise<number[][]> {
  if (input.length === 0) return [];

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("openai: OPENAI_API_KEY is not set");

  const res = await fetch(`${OPENAI_BASE_URL}/embeddings`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ model: EMBEDDING_MODEL, input }),
    // Bound the call so a hung upstream can't pin the Worker until it's killed.
    signal: aiTimeoutSignal(),
  });

  if (!res.ok) {
    // Keep the status in the message so classifyError can map it
    // (401 -> auth, 429 -> rate_limit) instead of an opaque failure.
    const detail = await res.text().catch(() => "");
    throw new Error(`openai embeddings ${res.status}: ${detail.slice(0, 500)}`);
  }

  const json = (await res.json()) as EmbeddingResponse;
  // The API echoes the input order via `index`; sort defensively before
  // stripping it so vectors line up with their source chunks.
  return json.data
    .slice()
    .sort((a, b) => a.index - b.index)
    .map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}
