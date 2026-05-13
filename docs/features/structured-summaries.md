# Feature: Structured Summaries

## Purpose

A free-form prose summary is fine for a glance, but when scanning many papers
researchers want consistent, sectioned output: methodology vs findings vs
limitations vs clinical implications, with sources for each claim. Structured
Summaries give exactly that, every section grounded in citations that link
back to the page in the PDF.

## UX flow

1. Open a paper -> **Summary** tab.
2. If no summary exists yet: empty state with a *Generate summary* CTA.
3. Click generate -> skeleton placeholders -> structured layout populates.
4. Sticky in-tab nav lets the user jump between the seven sections.
5. Each section header shows the citation count; expand to see clickable page badges that jump the PDF viewer.
6. Header bar shows the version (`v1`, `v2`, ...). Pin button stars the current version. Regenerate creates `v(n+1)`. Older versions are still available via the Versions list in the sidebar.
7. Errors render with the exact message and a retry button.

## Sections

The Zod schema (`StructuredSummary` in
[`src/lib/analyses/schemas.ts`](../../src/lib/analyses/schemas.ts)) requires:

- **Abstract Summary** - 2-3 sentence rephrasing in plain English.
- **Key Methodology** - bullet list of design / sample / instrumentation / analysis.
- **Main Findings** - bullets with effect direction and magnitude.
- **Limitations** - author-stated and reviewer-evident.
- **Clinical Relevance** - 1-2 sentences for a clinician.
- **Prosthetics, Orthotics & Assistive Robotics Relevance** - what the paper specifically contributes to POAR practice or design.
- **Future Research Directions** - concrete next steps.

Every section carries `citations: number[]` referencing the chunk registry.

## Technical implementation

- API: [`src/app/api/papers/[id]/summary/route.ts`](../../src/app/api/papers/[id]/summary/route.ts) (GET latest + version list, POST regenerate) and [`src/app/api/summaries/[id]/route.ts`](../../src/app/api/summaries/[id]/route.ts) (GET / PATCH pin/archive/rename / DELETE).
- Generator: [`src/lib/analyses/generateSummary.ts`](../../src/lib/analyses/generateSummary.ts) - calls `loadPaperContext()` to build a numbered chunk block + 1-indexed `Citation[]` registry, then `generateObject` with the strict Zod schema and the [SUMMARY_SYSTEM](../../src/lib/analyses/prompts.ts) prompt.
- Resolver: [`src/lib/analyses/resolve.ts`](../../src/lib/analyses/resolve.ts) maps each `citations: number[]` to a real `Citation[]` array from the stored registry. Done at read time so resolution is always against the saved registry, never re-running the model.
- UI: [`src/app/papers/[id]/_components/SummaryTab.tsx`](../../src/app/papers/[id]/_components/SummaryTab.tsx) - lazy-fetches on first activation, sticky sidebar nav, [`Collapsible`](../../src/components/ui/collapsible.tsx) per section, `CitationBadges` row at the bottom of each.
- Versioning: every regeneration inserts a new row with `version = max(version) + 1`. Latest non-archived is the "current" view. The Versions list in the sidebar lets the user load any prior version into the same UI.
- Persistence: `paper_summaries` (jsonb payload + jsonb citations registry + denormalised `title_tsv` for history search).

## Future improvements

- "Compare versions" diff view between any two versions of the same summary.
- Custom user prompt overrides per section (e.g. "for the methodology section, also list the statistical tests").
- Export to Markdown / LaTeX / Notion.
- Cross-summary aggregation: "summarise the methodology choices across all my AFO papers."
- Per-tag summary templates (e.g. exoskeleton papers always report metabolic-cost numbers).
