# Feature: Research History

## Purpose

Every structured artifact the user generates - summaries, terminology
extractions, paper comparisons - is persisted and revisitable. The History
page is the long-term workspace: a unified, searchable, pin/archive/delete
list across all three artifact kinds and all papers.

This is what makes the app a research workspace rather than a chat toy.

## UX flow

1. Top nav -> **History** -> `/history`.
2. Search bar with debounced FTS across titles + payload-headline fields + (for terminology) term names and expansions.
3. Archive toggle to flip between active and archived view.
4. Tabs: **All** / **Summaries** / **Terminology** / **Comparisons**, each with a count badge.
5. Rows show kind icon, version, paper(s), relative time, pin glyph for pinned entries.
6. Hover actions: pin / archive / delete (with confirm).
7. Click a row:
   - Summary -> `/papers/[id]?tab=summary`
   - Terminology -> `/papers/[id]?tab=terms`
   - Comparison -> `/compare/[id]`

Citations resolve at read time so every link still works after reload.

## Technical implementation

- Page: [`src/app/history/page.tsx`](../../src/app/history/page.tsx).
- Client: [`src/app/history/_components/HistoryClient.tsx`](../../src/app/history/_components/HistoryClient.tsx) - one component handling all four tabs, debounced search, optimistic mutations, hand-rolled empty / skeleton / error states.
- API: [`src/app/api/analyses/route.ts`](../../src/app/api/analyses/route.ts) - thin wrapper over the `search_analyses` RPC.
- RPC: [`search_analyses`](../../supabase/migrations/0005_analyses.sql) UNIONs `paper_summaries` (title FTS), `paper_terminology` (terms FTS), `paper_comparisons` (title + assessment FTS). Each row carries a `kind` discriminator.
- Per-row actions hit the kind-appropriate endpoint:
  - `PATCH /api/summaries/[id]` / `terminology/[id]` / `comparisons/[id]` for pin / archive / rename
  - `DELETE` on the same paths

## Sidebar / Settings touchpoints

- The Settings page surfaces three counters - "Saved summaries", "Terminology sets", "Saved comparisons" - so users see total volume at a glance.
- Pinned items always appear first inside their tab's list, regardless of tab.

## Future improvements

- Named research sessions: group analyses + chats + papers into a single project entity.
- Export a session to PDF / Markdown / Notion / Obsidian.
- Compare two versions of the same artifact side-by-side (we already store all versions, the diff UI is the missing piece).
- Tag analyses with user-defined labels independent of paper tags ("for thesis ch.3").
- Calendar view for activity-by-day.
- Public sharing of a single analysis via signed URL (with paper redaction options).
