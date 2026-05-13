# Feature: Terminology Mode

## Purpose

Reading domain papers as a non-expert is bottlenecked by jargon. Terminology
Mode extracts the teaching-relevant terms - acronyms, devices, sensors,
materials, control strategies - and explains each at three depths:

1. for someone **new to biomechanics**,
2. for an **undergraduate biomedical-engineering student**,
3. for a **clinical practitioner** working with assistive devices.

Pronunciation guides included for non-obvious terms.

## UX flow

1. Open a paper -> **Terms** tab.
2. Empty state -> *Extract terms* CTA.
3. Loading skeleton grid -> 15-30 term cards in a responsive grid.
4. Sticky in-tab sidebar lists categories with counts; click to filter.
5. Free-text filter at the top of the panel.
6. Click any card -> a right-side `<Drawer>` opens with three explanation tabs (Beginner / Technical / Clinical context) plus pronunciation and source citations.
7. Header bar: version badge, pin, regenerate.

## Categories

Inherits from the controlled vocabulary (see [`src/lib/tags.ts`](../../src/lib/tags.ts)):

- biomechanics, anatomy, device, material, sensor, outcome_measure, method, acronym, other.

The category-sidebar in the UI is computed from the actually-extracted terms,
not the full vocabulary - so the sidebar always reflects what is in this paper.

## Technical implementation

- API: [`src/app/api/papers/[id]/terminology/route.ts`](../../src/app/api/papers/[id]/terminology/route.ts) (GET / POST) and [`src/app/api/terminology/[id]/route.ts`](../../src/app/api/terminology/[id]/route.ts) (GET / PATCH / DELETE).
- Generator: [`src/lib/analyses/generateTerminology.ts`](../../src/lib/analyses/generateTerminology.ts) - same `loadPaperContext` + `generateObject` pattern. Schema: `TerminologyExtraction` with `terms: Term[]`. Each `Term` has `term`, `category`, `expansion`, `pronunciation`, `beginner_explanation`, `technical_explanation`, `clinical_context`, `citations: number[]`.
- Searchable blob: the generator stores a flattened `__searchable` field on the payload concatenating term names + expansions + categories. The DB has a generated `terms_tsv` over this field with a GIN index, so the unified history search hits term content directly.
- UI: [`src/app/papers/[id]/_components/TerminologyTab.tsx`](../../src/app/papers/[id]/_components/TerminologyTab.tsx). The detail [`Drawer`](../../src/components/ui/drawer.tsx) slides in from the right with [`Tabs`](../../src/components/ui/tabs.tsx) for the three explanation depths.
- Persistence: `paper_terminology` table; same versioning pattern as summaries (`(user_id, paper_id, version)` unique).

## Prompt design

The TERMINOLOGY_SYSTEM in [`src/lib/analyses/prompts.ts`](../../src/lib/analyses/prompts.ts):

- 15-30 terms target.
- Skip generic words ("study", "patient") unless used in a specific technical sense.
- Spell out every acronym in `expansion`.
- `beginner_explanation` must avoid jargon; suitable for someone who has never read a biomechanics paper.
- `technical_explanation` may use jargon and references.
- `clinical_context` connects to real prosthetic / orthotic / rehab practice.
- `pronunciation` only when non-obvious (e.g. `trans-TIB-ee-ul`).
- Cite the chunk(s) where the term appears via `citations: number[]`.

## Future improvements

- Inline highlighting of extracted terms in the chat answers (click an underlined term to open the same drawer).
- Personalised vocabulary: terms the user marks as "I know this" disappear from future extractions.
- Cross-paper terminology aggregation: "show me every term that appears in 5+ of my papers."
- Anki-style spaced repetition export for vocabulary the user wants to memorise.
- Interactive diagrams for spatial / anatomical terms (e.g. socket alignment, gait phases).
