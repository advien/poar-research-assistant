import { z } from "zod";

/**
 * Centralised request/body Zod schemas for the API routes.
 *
 * Putting them here gives us:
 *  - one place to harden validation
 *  - the ability to unit-test validation without spinning up a route handler
 *  - reuse from the rate-limit helper / observability layer for analytics
 */

// =============================================================================
// /api/chat
// =============================================================================
export const ChatMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  content: z.string().min(1).max(20_000),
});

export const ChatRequestSchema = z.object({
  messages: z.array(ChatMessageSchema).min(1).max(200),
  paper_id: z.string().uuid().nullable().optional(),
  chat_id: z.string().uuid().nullable().optional(),
});

export type ChatRequest = z.infer<typeof ChatRequestSchema>;

// =============================================================================
// /api/papers/upload
// =============================================================================
export const UploadRequestSchema = z.object({
  filename: z.string().min(1).max(256),
  size: z
    .number()
    .int()
    .positive()
    .max(100 * 1024 * 1024, { message: "files larger than 100 MB are not accepted" }),
});

export type UploadRequest = z.infer<typeof UploadRequestSchema>;

// =============================================================================
// /api/papers/ingest
// =============================================================================
export const IngestRequestSchema = z.object({
  paper_id: z.string().uuid(),
});

export type IngestRequest = z.infer<typeof IngestRequestSchema>;

// =============================================================================
// /api/comparisons
// =============================================================================
export const ComparisonRequestSchema = z.object({
  paper_a_id: z.string().uuid(),
  paper_b_id: z.string().uuid(),
});

export type ComparisonRequest = z.infer<typeof ComparisonRequestSchema>;

// =============================================================================
// /api/search
// =============================================================================
export const SearchRequestSchema = z.object({
  q: z.string().min(1).max(500),
  paper_id: z.string().uuid().nullable().optional(),
  limit: z.number().int().min(1).max(30).optional(),
});

export type SearchRequest = z.infer<typeof SearchRequestSchema>;

// =============================================================================
// helpers
// =============================================================================

export type ParseResult<T> =
  | { ok: true; data: T }
  | { ok: false; error: string; details: z.ZodIssue[] };

/**
 * Safely parse an unknown payload against a Zod schema and produce a discriminated
 * union the route handlers can branch on. Avoids try/catch noise in every route.
 */
export function safeParse<T>(schema: z.ZodSchema<T>, payload: unknown): ParseResult<T> {
  const result = schema.safeParse(payload);
  if (result.success) return { ok: true, data: result.data };
  const first = result.error.issues[0];
  const path = first?.path?.length ? first.path.join(".") + ": " : "";
  return {
    ok: false,
    error: `${path}${first?.message ?? "invalid request"}`,
    details: result.error.issues,
  };
}
