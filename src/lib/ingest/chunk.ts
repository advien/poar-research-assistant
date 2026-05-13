import type { ParsedPage } from "./parsePdf";

/**
 * Approximate token count. We avoid pulling in tiktoken to keep the bundle lean;
 * the OpenAI embedding model has an 8k ceiling so a 4-chars-per-token estimate
 * is fine for the ~800-token target.
 */
export function approxTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

const SECTION_RE =
  /\b(abstract|introduction|background|methods?|materials and methods|results?|discussion|conclusions?|references)\b/i;

function detectSection(prev: string | null, content: string): string | null {
  // Check the first ~120 chars for a section header.
  const head = content.slice(0, 120).split("\n")[0];
  const m = head.match(SECTION_RE);
  return m ? m[1].toLowerCase() : prev;
}

export type Chunk = {
  index: number;
  page_start: number;
  page_end: number;
  section: string | null;
  content: string;
  tokens: number;
};

export type ChunkOptions = {
  targetTokens?: number; // default 800
  overlapTokens?: number; // default 100
  minTokens?: number; // skip chunks shorter than this; default 40
};

/**
 * Token-aware chunker that preserves page boundaries. Walks pages sequentially,
 * splitting on paragraph boundaries when possible, and carries an overlap from
 * the tail of the previous chunk to keep cross-boundary context.
 */
export function chunkPages(pages: ParsedPage[], opts: ChunkOptions = {}): Chunk[] {
  const target = opts.targetTokens ?? 800;
  const overlap = opts.overlapTokens ?? 100;
  const minTokens = opts.minTokens ?? 40;

  const chunks: Chunk[] = [];
  let buf = "";
  let bufStart = pages[0]?.page ?? 1;
  let bufEnd = bufStart;
  let section: string | null = null;
  let index = 0;

  const flush = (force = false) => {
    const content = buf.trim();
    const tokens = approxTokens(content);
    if (!content || (tokens < minTokens && !force)) {
      buf = "";
      return;
    }
    section = detectSection(section, content);
    chunks.push({
      index: index++,
      page_start: bufStart,
      page_end: bufEnd,
      section,
      content,
      tokens,
    });
    // Carry the tail as overlap into the next chunk.
    const tailChars = overlap * 4;
    buf = content.slice(Math.max(0, content.length - tailChars));
    bufStart = bufEnd;
  };

  for (const { page, text } of pages) {
    const paragraphs = text.split(/\n{2,}/);
    for (const para of paragraphs) {
      const candidate = buf ? `${buf}\n\n${para}` : para;
      if (approxTokens(candidate) > target && buf) {
        flush();
        buf = buf ? `${buf}\n\n${para}` : para;
        bufStart = page;
        bufEnd = page;
      } else {
        buf = candidate;
        bufEnd = page;
      }
    }
  }
  flush(true);

  return chunks;
}
