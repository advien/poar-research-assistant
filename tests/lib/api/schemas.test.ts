import { describe, expect, it } from "vitest";
import {
  ChatRequestSchema,
  ComparisonRequestSchema,
  IngestRequestSchema,
  SearchRequestSchema,
  UploadRequestSchema,
  safeParse,
} from "@/lib/api/schemas";

const UUID = "11111111-1111-1111-1111-111111111111";
const UUID2 = "22222222-2222-2222-2222-222222222222";

describe("safeParse helper", () => {
  it("returns ok=true with the parsed data on success", () => {
    const result = safeParse(IngestRequestSchema, { paper_id: UUID });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.paper_id).toBe(UUID);
  });

  it("returns ok=false with a useful error string on failure", () => {
    const result = safeParse(IngestRequestSchema, { paper_id: "not-a-uuid" });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain("paper_id");
      expect(result.details.length).toBeGreaterThan(0);
    }
  });

  it("rejects entirely missing payloads", () => {
    expect(safeParse(IngestRequestSchema, undefined).ok).toBe(false);
    expect(safeParse(IngestRequestSchema, null).ok).toBe(false);
    expect(safeParse(IngestRequestSchema, "string").ok).toBe(false);
  });
});

describe("ChatRequestSchema", () => {
  it("accepts a minimal valid chat request", () => {
    const r = safeParse(ChatRequestSchema, {
      messages: [{ role: "user", content: "What dataset was used?" }],
    });
    expect(r.ok).toBe(true);
  });

  it("accepts paper_id and chat_id when provided as UUIDs", () => {
    const r = safeParse(ChatRequestSchema, {
      messages: [{ role: "user", content: "hi" }],
      paper_id: UUID,
      chat_id: UUID2,
    });
    expect(r.ok).toBe(true);
  });

  it("rejects empty messages array", () => {
    const r = safeParse(ChatRequestSchema, { messages: [] });
    expect(r.ok).toBe(false);
  });

  it("rejects non-UUID paper_id", () => {
    const r = safeParse(ChatRequestSchema, {
      messages: [{ role: "user", content: "hi" }],
      paper_id: "abc",
    });
    expect(r.ok).toBe(false);
  });

  it("rejects unknown role values", () => {
    const r = safeParse(ChatRequestSchema, {
      messages: [{ role: "tool", content: "hi" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects empty content (zero-length message)", () => {
    const r = safeParse(ChatRequestSchema, {
      messages: [{ role: "user", content: "" }],
    });
    expect(r.ok).toBe(false);
  });

  it("rejects absurdly long content (DoS protection)", () => {
    const r = safeParse(ChatRequestSchema, {
      messages: [{ role: "user", content: "a".repeat(20_001) }],
    });
    expect(r.ok).toBe(false);
  });
});

describe("UploadRequestSchema", () => {
  it("accepts a valid filename + size", () => {
    const r = safeParse(UploadRequestSchema, { filename: "paper.pdf", size: 1_000_000 });
    expect(r.ok).toBe(true);
  });

  it("rejects empty filename", () => {
    expect(safeParse(UploadRequestSchema, { filename: "", size: 1 }).ok).toBe(false);
  });

  it("rejects negative or zero file size", () => {
    expect(safeParse(UploadRequestSchema, { filename: "p.pdf", size: 0 }).ok).toBe(false);
    expect(safeParse(UploadRequestSchema, { filename: "p.pdf", size: -1 }).ok).toBe(false);
  });

  it("rejects files larger than 100 MB", () => {
    expect(
      safeParse(UploadRequestSchema, { filename: "p.pdf", size: 101 * 1024 * 1024 }).ok
    ).toBe(false);
  });
});

describe("ComparisonRequestSchema", () => {
  it("accepts two distinct UUIDs", () => {
    expect(
      safeParse(ComparisonRequestSchema, { paper_a_id: UUID, paper_b_id: UUID2 }).ok
    ).toBe(true);
  });

  it("rejects when one ID is not a UUID", () => {
    expect(
      safeParse(ComparisonRequestSchema, { paper_a_id: UUID, paper_b_id: "x" }).ok
    ).toBe(false);
  });
});

describe("SearchRequestSchema", () => {
  it("accepts a query within bounds", () => {
    expect(safeParse(SearchRequestSchema, { q: "ankle exoskeleton" }).ok).toBe(true);
  });

  it("rejects an empty query", () => {
    expect(safeParse(SearchRequestSchema, { q: "" }).ok).toBe(false);
  });

  it("clamps limit at 30", () => {
    expect(safeParse(SearchRequestSchema, { q: "x", limit: 31 }).ok).toBe(false);
  });
});
