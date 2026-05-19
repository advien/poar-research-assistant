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
/**
 * Hard cap on the upload size, in bytes. Defaults to 25 MiB - large enough
 * for typical 30-page biomedical PDFs but well below the 100 MiB Workers
 * request-body ceiling. Override per environment via `UPLOAD_MAX_BYTES`.
 *
 * NOTE: this only validates the *request metadata* (filename + size). The
 * browser PUTs bytes directly to Supabase Storage with a single-shot signed
 * URL, so the worker never streams the file body itself.
 */
const DEFAULT_UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
function uploadMaxBytes(): number {
  const raw = process.env.UPLOAD_MAX_BYTES;
  const n = raw ? Number.parseInt(raw, 10) : NaN;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_UPLOAD_MAX_BYTES;
}

/** Allowed MIME types. Today only PDF; OCR / Word / Markdown is roadmap. */
const ALLOWED_CONTENT_TYPES = new Set(["application/pdf"]);

export const UploadRequestSchema = z
  .object({
    filename: z
      .string()
      .min(1)
      .max(256)
      // Reject control chars, path traversal, NUL bytes. Keeps the storage
      // path safe and prevents `..` / `\\` shenanigans even though the bucket
      // path is already prefixed by user_id.
      .regex(/^[^/\\\x00-\x1f]+$/, {
        message: "filename contains invalid characters",
      })
      .refine((s) => /\.pdf$/i.test(s), {
        message: "only .pdf files are supported",
      }),
    size: z
      .number()
      .int()
      .positive()
      .refine((n) => n <= uploadMaxBytes(), {
        message: `files larger than ${Math.round(uploadMaxBytes() / 1024 / 1024)} MB are not accepted`,
      }),
    /**
     * Optional: the browser-reported Content-Type of the file. When present
     * we enforce it must be `application/pdf`. We can't trust the browser
     * but mismatched types are still a useful early-reject signal.
     */
    content_type: z
      .string()
      .max(128)
      .refine((t) => ALLOWED_CONTENT_TYPES.has(t.toLowerCase()), {
        message: "only application/pdf is accepted",
      })
      .optional(),
  })
  .strict();

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
