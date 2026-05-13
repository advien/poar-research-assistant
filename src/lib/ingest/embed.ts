import { embedBatch } from "@/lib/ai/openai";

/** Batch chunks into requests of at most `batchSize` strings. */
export async function embedAll(
  texts: string[],
  batchSize = 96
): Promise<number[][]> {
  const out: number[][] = [];
  for (let i = 0; i < texts.length; i += batchSize) {
    const slice = texts.slice(i, i + batchSize);
    const vectors = await embedBatch(slice);
    out.push(...vectors);
  }
  return out;
}
