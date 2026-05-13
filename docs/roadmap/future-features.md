# Future Features

What we want to build next, why, and a sketch of how. Items are ordered
roughly by **value-per-effort**.

---

## OCR fallback for scanned PDFs

### Why
Many older P&O / orthopedics journals only publish scans. unpdf returns no
text on these and ingestion fails fast. OCR closes the gap.

### Sketch
- After `parsePdf` returns `0` extractable characters, fall back to a vision
  pipeline:
  1. Render each page to PNG via PDF.js (already in the bundle).
  2. Send each page to Claude Sonnet vision with a `transcribe verbatim`
     system prompt.
  3. Run the transcribed text through the existing chunker + embedder.
- Cache transcribed pages keyed by `paper_id + page` to avoid re-running on
  regenerate.
- Status badge gains an `ocr` value alongside `parsing` to signal the slower
  path.

### Cost
~$0.03-0.10 per typical 12-page paper at current Sonnet pricing.

---

## Zotero / BibTeX / DOI auto-import

### Why
Most users already maintain a reference manager. Importing from Zotero
removes the friction of re-uploading.

### Sketch
- **DOI**: paste a DOI -> we hit Crossref / Unpaywall to find an open-access
  PDF -> upload it via the existing pipeline.
- **BibTeX**: drag-drop a `.bib` file -> for each entry, attempt DOI lookup
  + attached PDF.
- **Zotero API**: OAuth into Zotero -> sync collections -> ingest each item.
  Store the Zotero key on the paper row for round-trip annotation export.

### Schema changes
- `papers.source` text (`upload` | `doi` | `zotero`)
- `papers.external_ref` jsonb (`{ doi, zotero_key, ... }`)
- Optional `imports` table for tracking jobs.

---

## Notes & highlights with PDF anchors

### Why
Reading -> note-taking is the second-most-common action after reading itself.
Notes anchored back into the PDF turn the workspace into a real research
notebook.

### Sketch
- Highlight in the PDF viewer captures: paper id, page, text-layer span
  ranges, selected text.
- New `notes` table: `id, paper_id, user_id, page, span_start, span_end,
  selected_text, body, created_at`.
- Drawer panel listing notes per paper; click jumps to the highlight.
- Expose notes in the chat context: when chatting in a paper, prepend the
  user's notes to the system prompt.
- Future: AI-suggested notes ("you flagged this passage; here is what
  3 other papers in your library say about it").

---

## Collaborative research workspaces

### Why
Lab groups, thesis cohorts, and teams of clinicians need shared libraries.
RLS is already factored to support this with minimal change.

### Sketch
- New `workspaces` and `workspace_members` tables.
- All user-owned tables gain an optional `workspace_id`.
- RLS becomes `using ((user_id = auth.uid()) or (workspace_id in (select
  workspace_id from workspace_members where user_id = auth.uid())))`.
- Storage policies extended to allow workspace-folder access.
- Realtime channels keyed on `workspace_id` instead of `user_id` for shared
  workspaces.
- Per-workspace role (owner / editor / reader).

---

## AI research recommendations

### Why
Once a user has 30+ papers in the library, the assistant can proactively
surface gaps, contradictions, and reading suggestions instead of waiting for
a query.

### Sketch
- Nightly worker computes:
  - **Cluster gaps**: papers that span multiple clusters but have no chat /
    summary activity.
  - **Cross-paper contradictions**: pair-wise compare top-k similar papers,
    surface high-confidence contradictions.
  - **Outdated reads**: papers older than X with newer follow-ups in the
    library.
- Surfaced on a `/recommendations` page and as inline cards in `/library`.
- Eventually: suggest external papers via Semantic Scholar API given the
  library's centroid.

---

## Paper graph visualization

### Why
A library of 50+ papers has structure: shared authors, shared devices,
shared methodology. A graph view turns this into navigable insight.

### Sketch
- Node = paper, edge weight = composite of:
  - shared tag count,
  - cosine similarity of paper-level embedding (mean of chunk embeddings),
  - shared author / journal / DOI cross-references.
- Layout: ForceGraph2D on the client, computed lazily per visit.
- Click a node -> open the paper. Hover -> show summary excerpt.
- Filter by tag, year range, status.

---

## Biomedical terminology knowledge graph

### Why
Terminology Mode currently extracts terms per paper. A library-wide
knowledge graph turns isolated extractions into a navigable concept network.

### Sketch
- New `concepts` table: `id, slug, label, category, definition, embedding`.
- `concept_papers` linking table populated during terminology extraction
  (per-term occurrence with chunk evidence).
- Concept page: definition (synthesised from N papers), all papers that
  mention it, related concepts (vector neighbours), example passages.
- "Show me all my papers that discuss `impedance-control`" becomes a
  one-click action.
- Bootstrap from external ontologies (UMLS, MeSH) where licensing permits;
  otherwise grow organically.

---

## Background ingestion queue

### Why
Inline ingestion (current design, see [ADR-008](../engineering/decisions.md#adr-008-inline-ingestion-vs-background-queue))
is fine for solo use but blocks the request and is bound by the Cloudflare
30 s CPU limit on the Free tier.

### Sketch
- Cloudflare Queues + a worker consumer.
- API route enqueues `{ paper_id }` instead of running ingestion inline,
  returns 202 immediately.
- The same `ingestPaper(id)` orchestrator runs in the consumer, updating
  `papers.status` as it goes.
- UI behaviour unchanged - Realtime already keeps the badge in sync.

---

## Cross-paper synthesis ("what does my library say about X?")

### Why
The current cross-library chat answers per-question; users want a saveable
multi-paragraph synthesis ("write me a literature-review section on
metabolic-cost reduction in soft exosuits using my library").

### Sketch
- New endpoint: `POST /api/synthesis` with `{ topic, scope }`.
- Two-stage pipeline:
  1. Retrieve top-N relevant chunks across the library (hybrid search).
  2. Cluster by sub-topic, then for each cluster ask Claude to write a
     paragraph with citations.
- Save as a new artifact kind in `paper_syntheses` (parallel to summaries).
- Surfaced in the History tabs as a fourth kind.

---

## Robotics-aware extraction

### Why
Robotics papers have structure summaries don't capture: actuation type,
control law, intent-detection modality, sensor suite, DoF, mass, runtime.

### Sketch
- A second structured-output schema applied selectively (when the paper has
  a robotics tag): `RoboticsSpec`.
- New tab in the paper view: **Robotics spec**.
- Cross-paper robotics tables: comparable rows for every robotics paper in
  the library.

---

## Real-time collaborative annotations

### Why
Pairs with collaborative workspaces; lab groups want to annotate a paper
together in real time.

### Sketch
- Per-paper Realtime channel for annotations / chat presence.
- Cursor presence and selection broadcast.
- Threaded comments anchored to highlight ranges.

---

## Smaller follow-ups

- Persist partial assistant messages on disconnect.
- Diff view between any two versions of a structured artifact.
- Inline term highlighting in chat answers (click a term -> opens the
  Terminology drawer).
- Voice input / dictation for chat.
- Anki-style spaced repetition export of vocabulary.
- Export everything (chats, summaries, terminology, comparisons) to
  Markdown / Notion / Obsidian / RIS.
- Public sharing of a single artifact via signed URL.
- Per-conversation pinned papers.
- Multi-select bulk operations on the library.
- Folder / collection support for the library.
- Saved filters and pinned views.
- Dark / light mode toggle (already wired via CSS variables, just needs a
  switch).
- A11y polish on the hand-rolled UI primitives (focus traps in drawers,
  full keyboard nav for menus).
