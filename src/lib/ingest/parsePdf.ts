import { extractText, getDocumentProxy } from "unpdf";

export type ParsedPage = { page: number; text: string };

export type ParsePdfOptions = {
  /** Hard cap on page count. Throws if the PDF has more pages than this.
   *  Defaults to `INGEST_MAX_PAGES` env var, falling back to 200. */
  maxPages?: number;
};

const DEFAULT_MAX_PAGES = 200;

function resolveMaxPages(explicit?: number): number {
  if (typeof explicit === "number" && explicit > 0) return explicit;
  const raw = process.env.INGEST_MAX_PAGES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_PAGES;
}

export async function parsePdf(
  bytes: Uint8Array | ArrayBuffer,
  opts: ParsePdfOptions = {}
): Promise<{
  pages: ParsedPage[];
  totalPages: number;
}> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  const totalPages = pdf.numPages;

  // Reject oversized documents *before* spending the per-page extraction +
  // embedding budget. The classifier in observability/logger maps "too many
  // pages" to error_type=ingest_no_text-style non-transient, so the
  // ingestion pipeline fails fast without retrying.
  const maxPages = resolveMaxPages(opts.maxPages);
  if (totalPages > maxPages) {
    throw new Error(
      `PDF has ${totalPages} pages, exceeding the ${maxPages}-page limit. ` +
        "Trim the document or raise INGEST_MAX_PAGES."
    );
  }

  const { text } = await extractText(pdf, { mergePages: false });
  const arr = Array.isArray(text) ? text : [text];

  const pages: ParsedPage[] = arr.map((t, i) => ({
    page: i + 1,
    text: normalize(t),
  }));

  return { pages, totalPages };
}

/** Collapse whitespace and stitch hyphenated line breaks ("ortho-\nsis" -> "orthosis"). */
function normalize(s: string): string {
  return s
    .replace(/-\n([a-z])/g, "$1")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}
