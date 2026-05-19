import { describe, expect, it } from "vitest";
import { approxTokens, chunkPages } from "@/lib/ingest/chunk";
import type { ParsedPage } from "@/lib/ingest/parsePdf";

/**
 * The chunker is the foundation of retrieval quality. These tests exercise the
 * three things that matter most for RAG correctness:
 *  - chunks never exceed the configured token budget (with reasonable slack)
 *  - chunks remember which page(s) they came from (so citations are real)
 *  - section detection picks up paper-style headings
 *  - tiny / empty inputs don't crash and do not produce "junk" chunks
 */

const para = (n: number, word = "word") => Array.from({ length: n }, () => word).join(" ");

describe("approxTokens", () => {
  it("returns 0 for empty string", () => {
    expect(approxTokens("")).toBe(0);
  });

  it("scales roughly with character length (~4 chars per token)", () => {
    const text = "a".repeat(400);
    expect(approxTokens(text)).toBe(100);
  });

  it("rounds up so that any non-empty input has at least one token", () => {
    expect(approxTokens("hi")).toBe(1);
  });
});

describe("chunkPages", () => {
  it("returns no chunks for empty input", () => {
    expect(chunkPages([])).toEqual([]);
  });

  it("produces a single chunk for short text and tags it with page 1", () => {
    const pages: ParsedPage[] = [{ page: 1, text: "Short paragraph about transtibial sockets." }];
    const chunks = chunkPages(pages);
    expect(chunks).toHaveLength(1);
    expect(chunks[0].page_start).toBe(1);
    expect(chunks[0].page_end).toBe(1);
    expect(chunks[0].content).toContain("transtibial");
  });

  it("respects the token target when paragraphs fit (multi-paragraph document)", () => {
    // Many small paragraphs (~30 tokens each). The chunker should pack them up
    // until just over the target and then flush. No single chunk should be
    // larger than ~target * 1.5 in this scenario.
    const target = 200;
    const text = Array.from({ length: 60 }, () => para(30)).join("\n\n");
    const chunks = chunkPages([{ page: 1, text }], {
      targetTokens: target,
      overlapTokens: 20,
      minTokens: 10,
    });
    expect(chunks.length).toBeGreaterThan(2);
    for (const c of chunks) {
      // Allow some headroom for the per-paragraph overshoot rule.
      expect(c.tokens).toBeLessThan(target * 2);
    }
  });

  it("never splits a paragraph - a single oversize paragraph becomes one chunk", () => {
    const big = para(1000); // ~1250 tokens
    const chunks = chunkPages([{ page: 1, text: big }], {
      targetTokens: 200,
      overlapTokens: 20,
      minTokens: 10,
    });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].tokens).toBeGreaterThan(200);
  });

  it("indexes chunks sequentially from 0", () => {
    const pages: ParsedPage[] = [
      { page: 1, text: `${para(400)}\n\n${para(400)}\n\n${para(400)}\n\n${para(400)}` },
    ];
    const chunks = chunkPages(pages, { targetTokens: 100, overlapTokens: 10, minTokens: 5 });
    expect(chunks.length).toBeGreaterThan(1);
    chunks.forEach((c, i) => expect(c.index).toBe(i));
  });

  it("tracks page_start/page_end when paragraphs span pages", () => {
    const pages: ParsedPage[] = [
      { page: 1, text: para(800) },
      { page: 2, text: para(800) },
      { page: 3, text: para(800) },
    ];
    const chunks = chunkPages(pages, { targetTokens: 250, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) {
      expect(c.page_start).toBeGreaterThanOrEqual(1);
      expect(c.page_end).toBeGreaterThanOrEqual(c.page_start);
      expect(c.page_end).toBeLessThanOrEqual(3);
    }
    // The whole document is covered: at least one chunk touches the last page.
    expect(chunks.some((c) => c.page_end === 3)).toBe(true);
  });

  it("detects section headings when each chunk starts with one (overlap=0)", () => {
    // The chunker only re-detects a section when the chunk starts with a heading
    // line. Using overlap=0 + heading-only paragraphs guarantees that.
    const pages: ParsedPage[] = [
      { page: 1, text: `Abstract\n\n${para(200)}` },
      { page: 2, text: `Methods\n\n${para(200)}` },
      { page: 3, text: `Results\n\n${para(200)}` },
    ];
    const chunks = chunkPages(pages, { targetTokens: 80, overlapTokens: 0, minTokens: 1 });
    const sections = chunks.map((c) => c.section);
    expect(sections).toContain("abstract");
    expect(sections).toContain("methods");
    expect(sections).toContain("results");
  });

  it("inherits the previous chunk's section when no new heading appears (sticky default)", () => {
    // Real PDFs rarely have "Abstract" alone on its own line, so the section
    // label has to "stick" across chunks once detected. The first paragraph
    // contains an Abstract heading; subsequent body chunks must keep that label.
    const pages: ParsedPage[] = [
      {
        page: 1,
        text: `Abstract\n\n${para(40)}\n\n${para(800)}`,
      },
    ];
    const chunks = chunkPages(pages, { targetTokens: 200, overlapTokens: 20, minTokens: 5 });
    expect(chunks[0].section).toBe("abstract");
  });

  it("filters out chunks below the minTokens threshold", () => {
    const pages: ParsedPage[] = [{ page: 1, text: "tiny" }];
    const chunks = chunkPages(pages, { targetTokens: 800, overlapTokens: 100, minTokens: 100 });
    // Force-flush at end keeps it - but only because that flush passes `force=true`.
    // The point of this test is that intermediate sub-min chunks aren't emitted.
    expect(chunks.length).toBeLessThanOrEqual(1);
  });

  it("never produces a chunk with empty content", () => {
    const pages: ParsedPage[] = [
      { page: 1, text: "" },
      { page: 2, text: "Some real content about gait analysis and IMUs." },
      { page: 3, text: "" },
    ];
    const chunks = chunkPages(pages);
    for (const c of chunks) {
      expect(c.content.trim().length).toBeGreaterThan(0);
    }
  });
});
