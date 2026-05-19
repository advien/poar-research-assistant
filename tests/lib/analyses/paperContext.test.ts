import { describe, expect, it } from "vitest";
import { resolveCitationRefs } from "@/lib/analyses/paperContext";
import { resolveComparisonRefs, resolveStoredSummary } from "@/lib/analyses/resolve";
import type { Citation, ComparisonRow } from "@/types/db";

const cite = (n: number): Citation => ({
  n,
  chunk_id: `chunk-${n}`,
  paper_id: "paper-1",
  page_start: n,
  page_end: n,
  snippet: `snippet ${n}`,
});

const REGISTRY: Citation[] = [cite(1), cite(2), cite(3), cite(4)];

describe("resolveCitationRefs (1-indexed numeric refs)", () => {
  it("resolves valid refs in order", () => {
    const out = resolveCitationRefs([1, 3], REGISTRY);
    expect(out).toHaveLength(2);
    expect(out[0].chunk_id).toBe("chunk-1");
    expect(out[1].chunk_id).toBe("chunk-3");
  });

  it("drops out-of-range refs (model hallucination)", () => {
    expect(resolveCitationRefs([0, 5, 99, -1], REGISTRY)).toEqual([]);
  });

  it("drops non-integer refs", () => {
    // @ts-expect-error - simulating a malformed ref slipping through
    const out = resolveCitationRefs([1.5, "2"], REGISTRY);
    expect(out).toEqual([]);
  });

  it("dedupes repeated refs", () => {
    const out = resolveCitationRefs([2, 2, 3, 2], REGISTRY);
    expect(out.map((c) => c.chunk_id)).toEqual(["chunk-2", "chunk-3"]);
  });

  it("returns empty array for undefined / empty refs", () => {
    expect(resolveCitationRefs(undefined, REGISTRY)).toEqual([]);
    expect(resolveCitationRefs([], REGISTRY)).toEqual([]);
  });
});

describe("resolveComparisonRefs (string A1/B7 refs)", () => {
  const compRegistry: ComparisonRow["citations"] = [
    {
      ref: "A1",
      chunk_id: "chunk-a-1",
      paper_id: "paper-a",
      page_start: 1,
      page_end: 1,
      snippet: "A1 snippet",
    },
    {
      ref: "A2",
      chunk_id: "chunk-a-2",
      paper_id: "paper-a",
      page_start: 2,
      page_end: 2,
      snippet: "A2 snippet",
    },
    {
      ref: "B1",
      chunk_id: "chunk-b-1",
      paper_id: "paper-b",
      page_start: 3,
      page_end: 3,
      snippet: "B1 snippet",
    },
  ];

  it("resolves A/B prefixed refs", () => {
    const out = resolveComparisonRefs(["A1", "B1"], compRegistry);
    expect(out).toHaveLength(2);
    expect(out[0].ref).toBe("A1");
    expect(out[1].ref).toBe("B1");
  });

  it("drops unknown refs", () => {
    const out = resolveComparisonRefs(["A99", "Z1", "B1"], compRegistry);
    expect(out.map((c) => c.ref)).toEqual(["B1"]);
  });

  it("dedupes repeated refs", () => {
    const out = resolveComparisonRefs(["A1", "A1", "B1"], compRegistry);
    expect(out.map((c) => c.ref)).toEqual(["A1", "B1"]);
  });

  it("returns empty array for undefined / empty refs", () => {
    expect(resolveComparisonRefs(undefined, compRegistry)).toEqual([]);
    expect(resolveComparisonRefs([], compRegistry)).toEqual([]);
  });
});

describe("resolveStoredSummary", () => {
  it("re-derives concrete Citation arrays from a stored payload", () => {
    const payload = {
      abstract_summary: { text: "Abstract.", citations: [1] },
      key_methodology: { items: ["m1"], citations: [1, 2] },
      main_findings: { items: ["f1"], citations: [3] },
      limitations: { items: ["l1"], citations: [] },
      clinical_relevance: { text: "clin", citations: [4] },
      po_relevance: { text: "po", citations: [4, 99] },
      future_directions: { items: ["fut"], citations: [2] },
    };
    const resolved = resolveStoredSummary(payload, REGISTRY);
    expect(resolved.abstract_summary.citations.map((c) => c.n)).toEqual([1]);
    expect(resolved.po_relevance.citations.map((c) => c.n)).toEqual([4]); // 99 dropped
    expect(resolved.limitations.citations).toEqual([]);
  });
});
