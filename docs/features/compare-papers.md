# Feature: Compare Papers

## Purpose

Pick any two ingested papers, get a structured side-by-side comparison plus a
similarity score, contradiction detection, and a "which paper is
methodologically stronger" verdict - all citation-linked back to specific
pages of the source PDFs.

## UX flow

1. Top nav -> **Compare** -> `/compare`.
2. Picker: two `<select>`s for paper A and paper B (only `status='ready'` papers listed).
3. Recent comparisons listed below the picker; click to reopen.
4. Click **Generate comparison** -> Claude is called -> redirect to `/compare/[id]`.
5. Comparison page shows:
   - similarity score badge (0-100%),
   - a Trophy badge naming the stronger paper (or "tie" / "undetermined"),
   - contradiction count badge,
   - two paper-header cards with author / year / open-paper links,
   - a single Card with eight stacked side-by-side rows (methodology, participants, outcome measures, devices/sensors, rehab approach, strengths, weaknesses, clinical implications),
   - a dedicated Contradictions card if any exist - each contradiction is a `<Collapsible>` with paper-A claim vs paper-B claim and citations.
6. Header bar: Pin / Regenerate (creates v(n+1)) / Delete (with confirm).
7. Citation badges look like `A p.4` or `B p.7` and link to the source paper.

## Sections (`PaperComparison` schema)

Each compared field has a `{ a, b, citations: string[] }` shape where
citations look like `"A3"` or `"B7"`.

- methodology
- participants
- outcome_measures
- devices_sensors
- rehabilitation_approach
- strengths
- weaknesses
- clinical_implications

Plus:

- `contradictions: { topic, paper_a_claim, paper_b_claim, citations }[]`
- `similarity_score: 0..1`
- `stronger_paper: 'a' | 'b' | 'tie' | 'undetermined'`
- `overall_assessment: { text, citations }`

## Technical implementation

- API: [`src/app/api/comparisons/route.ts`](../../src/app/api/comparisons/route.ts) (GET list + filters, POST generate) and [`src/app/api/comparisons/[id]/route.ts`](../../src/app/api/comparisons/[id]/route.ts) (GET / PATCH / DELETE).
- Generator: [`src/lib/analyses/generateComparison.ts`](../../src/lib/analyses/generateComparison.ts). Loads context for both papers via two parallel `loadPaperContext({ prefix: 'A', maxChars: 35_000 })` / `({ prefix: 'B', ... })` calls. Builds a unified prompt with `[A1]..[An]`, `[B1]..[Bn]` numbering. `generateObject` enforces the `PaperComparison` Zod schema.
- Pair normalisation: `orderPaperIds(a, b)` returns `(min, max)` so the unique key `(user_id, paper_a_id, paper_b_id, version)` is stable regardless of selection order. The DB also enforces this with a `paper_a_id < paper_b_id` check constraint.
- Versioning: `version = max(version) + 1` per ordered pair.
- Resolver: [`resolveComparisonRefs`](../../src/lib/analyses/resolve.ts) takes the prefixed-string refs (`"A3"` / `"B7"`) and resolves to entries in the stored `citations` registry.
- UI: [`src/app/compare/_components/ComparisonView.tsx`](../../src/app/compare/_components/ComparisonView.tsx) renders the side-by-side and the contradictions list. [`ComparePicker.tsx`](../../src/app/compare/_components/ComparePicker.tsx) drives the picker page.
- Header CTA: a Compare link in the per-paper Tabs bar pre-fills `?a=<paperId>` so users can launch a comparison from any paper view.

## Future improvements

- Three-way and N-way comparisons (matrix view).
- Compare a paper against a "consensus" synthesised from the user's library.
- Statistical-result extraction (effect sizes, p-values, CIs) tabulated for direct comparison.
- Conflict-resolution mode: for each contradiction, query Claude for the most likely cause (different population? different protocol? statistical issue?).
- Export to Markdown / LaTeX / RIS for inclusion in a literature review section.
