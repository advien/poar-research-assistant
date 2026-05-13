import OpenAI from "openai";

export const EMBEDDING_MODEL = "text-embedding-3-small";
export const EMBEDDING_DIM = 1536;

let _client: OpenAI | null = null;

export function openai(): OpenAI {
  if (!_client) {
    _client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
  }
  return _client;
}

/** Embed a batch of strings. OpenAI accepts up to 2048 inputs per request. */
export async function embedBatch(input: string[]): Promise<number[][]> {
  if (input.length === 0) return [];
  const res = await openai().embeddings.create({
    model: EMBEDDING_MODEL,
    input,
  });
  return res.data.map((d) => d.embedding);
}

export async function embedQuery(text: string): Promise<number[]> {
  const [v] = await embedBatch([text]);
  return v;
}
