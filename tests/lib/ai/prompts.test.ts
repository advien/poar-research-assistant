import { describe, expect, it } from "vitest";
import {
  RAG_SYSTEM_PROMPT,
  METADATA_SYSTEM_PROMPT,
  SUMMARY_SYSTEM_PROMPT,
  buildContextBlock,
} from "@/lib/ai/prompts";

/**
 * The RAG system prompt is the steering wheel of the whole product. We do not
 * snapshot it word-for-word (we tweak wording often), but we do require:
 *  - it tells the model to cite as [n]
 *  - it explicitly forbids inventing facts
 *  - the buildContextBlock helper produces deterministic, parseable output
 */

describe("system prompts", () => {
  it("RAG prompt instructs Claude to cite as [n]", () => {
    expect(RAG_SYSTEM_PROMPT).toMatch(/\[1\]/);
    expect(RAG_SYSTEM_PROMPT.toLowerCase()).toContain("cite");
  });

  it("RAG prompt forbids fabrication", () => {
    expect(RAG_SYSTEM_PROMPT.toLowerCase()).toMatch(/never invent|do not invent|not in the context/);
  });

  it("metadata + summary prompts include the POAR domain primer", () => {
    expect(METADATA_SYSTEM_PROMPT).toMatch(/prosthetics|orthotics|assistive/i);
    expect(SUMMARY_SYSTEM_PROMPT).toMatch(/prosthetics|orthotics|assistive/i);
  });
});

describe("buildContextBlock", () => {
  const chunks = [
    {
      paper_id: "11111111-1111-1111-1111-111111111111",
      page_start: 4,
      page_end: 4,
      content: "We recruited 12 transtibial amputees for the gait trial.",
    },
    {
      paper_id: "22222222-2222-2222-2222-222222222222",
      page_start: 7,
      page_end: 8,
      content: "The exoskeleton reduced metabolic cost by 14% (p < 0.01).",
    },
    {
      paper_id: "33333333-3333-3333-3333-333333333333",
      page_start: null,
      page_end: null,
      content: "Methods are described above.",
    },
  ];

  it("numbers chunks 1-indexed", () => {
    const block = buildContextBlock(chunks);
    expect(block).toMatch(/^\[1\]/);
    expect(block).toContain("[2]");
    expect(block).toContain("[3]");
  });

  it("renders single-page citation as p.N", () => {
    const block = buildContextBlock(chunks);
    expect(block).toContain("p.4");
  });

  it("renders multi-page span as pp.N-M", () => {
    const block = buildContextBlock(chunks);
    expect(block).toContain("pp.7-8");
  });

  it("falls back to p.? when page is unknown", () => {
    const block = buildContextBlock(chunks);
    expect(block).toContain("p.?");
  });

  it("preserves chunk content verbatim", () => {
    const block = buildContextBlock(chunks);
    expect(block).toContain("transtibial amputees");
    expect(block).toContain("metabolic cost by 14%");
  });

  it("returns an empty-ish block for zero chunks (caller handles fallback messaging)", () => {
    expect(buildContextBlock([])).toBe("");
  });
});
