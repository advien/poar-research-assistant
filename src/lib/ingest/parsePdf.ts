import { extractText, getDocumentProxy } from "unpdf";

export type ParsedPage = { page: number; text: string };

export async function parsePdf(bytes: Uint8Array | ArrayBuffer): Promise<{
  pages: ParsedPage[];
  totalPages: number;
}> {
  const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const pdf = await getDocumentProxy(data);
  const totalPages = pdf.numPages;

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
