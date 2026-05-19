/**
 * Hand-written DB types for the MVP. Replace with `supabase gen types typescript`
 * once the project is linked to a Supabase instance.
 */

export type PaperStatus =
  | "pending"
  | "parsing"
  | "embedding"
  | "summarizing"
  | "ready"
  | "failed"
  | "retrying";

export type Citation = {
  n: number;
  chunk_id: string;
  paper_id: string;
  page_start: number | null;
  page_end: number | null;
  snippet: string;
};

export type PaperRow = {
  id: string;
  user_id: string;
  title: string | null;
  authors: string[];
  journal: string | null;
  year: number | null;
  doi: string | null;
  abstract: string | null;
  tags: string[];
  storage_path: string;
  page_count: number | null;
  status: PaperStatus;
  error: string | null;
  summary: string | null;
  /** Monotonically increasing per-paper retry counter. */
  ingest_attempts: number;
  ingest_started_at: string | null;
  ingest_finished_at: string | null;
  /** 0..100, advisory only. 100 implies status === "ready". */
  ingest_progress_pct: number;
  created_at: string;
  updated_at: string;
};

export type ChunkRow = {
  id: string;
  paper_id: string;
  user_id: string;
  chunk_index: number;
  page_start: number | null;
  page_end: number | null;
  section: string | null;
  content: string;
  tokens: number | null;
  embedding: number[] | null;
  created_at: string;
};

export type ChatRow = {
  id: string;
  user_id: string;
  paper_id: string | null;
  title: string | null;
  archived: boolean;
  pinned: boolean;
  last_message_at: string | null;
  message_count: number;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

/** Trimmed projection used by the sidebar (cheap to query). */
export type ChatListItem = Pick<
  ChatRow,
  | "id"
  | "paper_id"
  | "title"
  | "archived"
  | "pinned"
  | "message_count"
  | "last_message_at"
  | "created_at"
  | "updated_at"
> & {
  paper?: { id: string; title: string | null } | null;
};

export type ChatWithMessages = ChatRow & {
  paper: { id: string; title: string | null; storage_path: string } | null;
  messages: Pick<MessageRow, "id" | "role" | "content" | "citations" | "created_at">[];
};

export type ChatListPage = {
  pinned: ChatListItem[];
  items: ChatListItem[];
  next_cursor: string | null;
};

// =============================================================================
// Analyses (structured summary, terminology, comparisons)
// =============================================================================

export type AnalysisKind = "summary" | "terminology" | "comparison";

export type SummaryRow = {
  id: string;
  user_id: string;
  paper_id: string;
  version: number;
  payload: import("@/lib/analyses/schemas").StructuredSummaryT;
  citations: Citation[];
  title: string | null;
  pinned: boolean;
  archived: boolean;
  model: string | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
};

export type TerminologyRow = {
  id: string;
  user_id: string;
  paper_id: string;
  version: number;
  payload: import("@/lib/analyses/schemas").TerminologyExtractionT & { __searchable?: string };
  citations: Citation[];
  term_count: number;
  pinned: boolean;
  archived: boolean;
  model: string | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
};

export type ComparisonRow = {
  id: string;
  user_id: string;
  paper_a_id: string;
  paper_b_id: string;
  version: number;
  payload: import("@/lib/analyses/schemas").PaperComparisonT;
  /** Citations indexed under "A1", "A2", ... and "B1", "B2", ... */
  citations: { ref: string; chunk_id: string; paper_id: string; page_start: number | null; page_end: number | null; snippet: string }[];
  similarity_score: number | null;
  stronger_paper: "a" | "b" | "tie" | "undetermined" | null;
  contradiction_count: number;
  title: string | null;
  pinned: boolean;
  archived: boolean;
  model: string | null;
  prompt_version: string;
  created_at: string;
  updated_at: string;
};

export type AnalysisHistoryItem = {
  kind: AnalysisKind;
  id: string;
  paper_id: string | null;
  paper_a_id: string | null;
  paper_b_id: string | null;
  title: string | null;
  version: number;
  pinned: boolean;
  archived: boolean;
  created_at: string;
  updated_at: string;
  rank?: number;
  /** Hydrated client-side. */
  papers?: { id: string; title: string | null }[];
};

export type MessageRow = {
  id: string;
  chat_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations: Citation[];
  created_at: string;
};

// =============================================================================
// Database — plain literal Insert / Update shapes (no `Partial<X> & Pick<X,K>`).
//
// postgrest-js does deep type computation over the Insert / Update types and
// can resolve them to `never` when they are mapped-type intersections. The
// supabase code generator always emits plain object literals; we mirror that
// exactly here.
// =============================================================================

export type PaperInsert = {
  id?: string;
  user_id: string;
  title?: string | null;
  authors?: string[];
  journal?: string | null;
  year?: number | null;
  doi?: string | null;
  abstract?: string | null;
  tags?: string[];
  storage_path: string;
  page_count?: number | null;
  status?: PaperStatus;
  error?: string | null;
  summary?: string | null;
  ingest_attempts?: number;
  ingest_started_at?: string | null;
  ingest_finished_at?: string | null;
  ingest_progress_pct?: number;
  created_at?: string;
  updated_at?: string;
};

export type PaperUpdate = {
  id?: string;
  user_id?: string;
  title?: string | null;
  authors?: string[];
  journal?: string | null;
  year?: number | null;
  doi?: string | null;
  abstract?: string | null;
  tags?: string[];
  storage_path?: string;
  page_count?: number | null;
  status?: PaperStatus;
  error?: string | null;
  summary?: string | null;
  ingest_attempts?: number;
  ingest_started_at?: string | null;
  ingest_finished_at?: string | null;
  ingest_progress_pct?: number;
  created_at?: string;
  updated_at?: string;
};

export type ChunkInsert = {
  id?: string;
  paper_id: string;
  user_id: string;
  chunk_index: number;
  page_start?: number | null;
  page_end?: number | null;
  section?: string | null;
  content: string;
  tokens?: number | null;
  embedding?: number[] | null;
  created_at?: string;
};

export type ChunkUpdate = Partial<ChunkInsert>;

export type ChatInsert = {
  id?: string;
  user_id: string;
  paper_id?: string | null;
  title?: string | null;
  archived?: boolean;
  pinned?: boolean;
  last_message_at?: string | null;
  message_count?: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type ChatUpdate = {
  id?: string;
  user_id?: string;
  paper_id?: string | null;
  title?: string | null;
  archived?: boolean;
  pinned?: boolean;
  last_message_at?: string | null;
  message_count?: number;
  metadata?: Record<string, unknown>;
  created_at?: string;
  updated_at?: string;
};

export type MessageInsert = {
  id?: string;
  chat_id: string;
  user_id: string;
  role: "user" | "assistant" | "system";
  content: string;
  citations?: Citation[];
  created_at?: string;
};

export type MessageUpdate = Partial<MessageInsert>;

export type SummaryInsert = {
  id?: string;
  user_id: string;
  paper_id: string;
  version?: number;
  payload: SummaryRow["payload"];
  citations?: Citation[];
  title?: string | null;
  pinned?: boolean;
  archived?: boolean;
  model?: string | null;
  prompt_version?: string;
  created_at?: string;
  updated_at?: string;
};

export type SummaryUpdate = {
  id?: string;
  user_id?: string;
  paper_id?: string;
  version?: number;
  payload?: SummaryRow["payload"];
  citations?: Citation[];
  title?: string | null;
  pinned?: boolean;
  archived?: boolean;
  model?: string | null;
  prompt_version?: string;
  created_at?: string;
  updated_at?: string;
};

export type TerminologyInsert = {
  id?: string;
  user_id: string;
  paper_id: string;
  version?: number;
  payload: TerminologyRow["payload"];
  citations?: Citation[];
  term_count?: number;
  pinned?: boolean;
  archived?: boolean;
  model?: string | null;
  prompt_version?: string;
  created_at?: string;
  updated_at?: string;
};

export type TerminologyUpdate = {
  id?: string;
  user_id?: string;
  paper_id?: string;
  version?: number;
  payload?: TerminologyRow["payload"];
  citations?: Citation[];
  term_count?: number;
  pinned?: boolean;
  archived?: boolean;
  model?: string | null;
  prompt_version?: string;
  created_at?: string;
  updated_at?: string;
};

export type ComparisonInsert = {
  id?: string;
  user_id: string;
  paper_a_id: string;
  paper_b_id: string;
  version?: number;
  payload: ComparisonRow["payload"];
  citations?: ComparisonRow["citations"];
  similarity_score?: number | null;
  stronger_paper?: "a" | "b" | "tie" | "undetermined" | null;
  contradiction_count?: number;
  title?: string | null;
  pinned?: boolean;
  archived?: boolean;
  model?: string | null;
  prompt_version?: string;
  created_at?: string;
  updated_at?: string;
};

export type ComparisonUpdate = {
  id?: string;
  user_id?: string;
  paper_a_id?: string;
  paper_b_id?: string;
  version?: number;
  payload?: ComparisonRow["payload"];
  citations?: ComparisonRow["citations"];
  similarity_score?: number | null;
  stronger_paper?: "a" | "b" | "tie" | "undetermined" | null;
  contradiction_count?: number;
  title?: string | null;
  pinned?: boolean;
  archived?: boolean;
  model?: string | null;
  prompt_version?: string;
  created_at?: string;
  updated_at?: string;
};

// ---------------------------------------------------------------------------
// IMPORTANT: postgrest-js (>= the version paired with supabase-js 2.50+)
// constrains every table's Row/Insert/Update and every function's Args to
// `Record<string, unknown>`. A plain `{ id: string }` does NOT satisfy
// `Record<string, unknown>` without an index signature, which causes the
// SupabaseClient's `Schema` generic to fall back to `never` and every
// `.from(...)`, `.update(...)`, `.insert(...)`, `.rpc(...)` call to typecheck
// against `never`. We add an index signature via intersection with
// `Record<string, unknown>` to keep our explicit row types AND satisfy the
// constraint.
// ---------------------------------------------------------------------------
type Indexed<T> = T & Record<string, unknown>;

export type Database = {
  public: {
    Tables: {
      papers:            { Row: Indexed<PaperRow>;       Insert: Indexed<PaperInsert>;       Update: Indexed<PaperUpdate>;       Relationships: [] };
      chunks:            { Row: Indexed<ChunkRow>;       Insert: Indexed<ChunkInsert>;       Update: Indexed<ChunkUpdate>;       Relationships: [] };
      chats:             { Row: Indexed<ChatRow>;        Insert: Indexed<ChatInsert>;        Update: Indexed<ChatUpdate>;        Relationships: [] };
      messages:          { Row: Indexed<MessageRow>;     Insert: Indexed<MessageInsert>;     Update: Indexed<MessageUpdate>;     Relationships: [] };
      paper_summaries:   { Row: Indexed<SummaryRow>;     Insert: Indexed<SummaryInsert>;     Update: Indexed<SummaryUpdate>;     Relationships: [] };
      paper_terminology: { Row: Indexed<TerminologyRow>; Insert: Indexed<TerminologyInsert>; Update: Indexed<TerminologyUpdate>; Relationships: [] };
      paper_comparisons: { Row: Indexed<ComparisonRow>;  Insert: Indexed<ComparisonInsert>;  Update: Indexed<ComparisonUpdate>;  Relationships: [] };
    };
    Views: { [_ in never]: never };
    Functions: {
      match_chunks: {
        Args: Indexed<{
          query_embedding: number[];
          match_count?: number;
          filter_paper_id?: string | null;
        }>;
        Returns: Array<{
          id: string;
          paper_id: string;
          chunk_index: number;
          page_start: number | null;
          page_end: number | null;
          section: string | null;
          content: string;
          similarity: number;
        }>;
      };
      search_chats: {
        Args: Indexed<{
          q: string;
          filter_paper_id?: string | null;
          include_archived?: boolean;
          match_count?: number;
        }>;
        Returns: Array<{
          id: string;
          paper_id: string | null;
          title: string | null;
          archived: boolean;
          pinned: boolean;
          message_count: number;
          last_message_at: string | null;
          created_at: string;
          updated_at: string;
          rank: number;
        }>;
      };
      search_analyses: {
        Args: Indexed<{
          q: string;
          filter_kind?: AnalysisKind | null;
          filter_paper_id?: string | null;
          include_archived?: boolean;
          match_count?: number;
        }>;
        Returns: Array<{
          kind: AnalysisKind;
          id: string;
          paper_id: string | null;
          paper_a_id: string | null;
          paper_b_id: string | null;
          title: string | null;
          version: number;
          pinned: boolean;
          archived: boolean;
          created_at: string;
          updated_at: string;
          rank: number;
        }>;
      };
      hybrid_search: {
        Args: Indexed<{
          query_text: string;
          query_embedding: number[];
          match_count?: number;
          filter_paper_id?: string | null;
          rrf_k?: number;
        }>;
        Returns: Array<{
          id: string;
          paper_id: string;
          chunk_index: number;
          page_start: number | null;
          page_end: number | null;
          section: string | null;
          content: string;
          score: number;
        }>;
      };
    };
    Enums: { [_ in never]: never };
    CompositeTypes: { [_ in never]: never };
  };
};
