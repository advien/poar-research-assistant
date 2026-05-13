# Project Summary

A narrative for portfolio reviewers, recruiters, and interview conversation.
Engineering specifics live in the rest of `docs/`; this is the "why and what
I learned" version.

## Headline

**POAR Research Assistant** is a production-shaped AI research workspace for
prosthetics, orthotics, and assistive-robotics literature. Drop a PDF in, and
the app extracts metadata, embeds the full text, writes a structured summary,
extracts domain terminology with three explanation depths, and lets you chat
with one paper or your whole library - every claim citation-linked back to a
specific PDF page. Compare any two papers and you get a similarity score,
contradiction list, and a verdict on which paper is methodologically stronger.

Built solo on Next.js 15 + Supabase (Postgres + pgvector) with Anthropic
Claude for generation and OpenAI for embeddings. Deployed to Cloudflare
Pages via the OpenNext adapter at `https://research.advien.tech`.

## Project goals

1. **Solve a real problem.** Reading prosthetics / orthotics / biomechanics
   literature is heavy work. The vocabulary is dense, the methodology
   sections are dense, and comparing papers is mechanical labour the LLM
   should handle.
2. **Production-shaped.** Not a notebook demo. End-to-end RLS, keyset
   pagination, structured outputs with citation resolution, mobile
   responsiveness, error boundaries, deployment story.
3. **Not a chat toy.** Persistent artifacts. A summary, terminology
   extraction, or comparison generated today is searchable, pinnable, and
   re-openable in three months.
4. **A portfolio piece.** Public demo, professional README, clean GitHub repo,
   thorough docs - so a recruiter can read the surface and a collaborator
   can read the depth.

## Biomedical engineering relevance

Why this domain rather than "another GPT chat for PDFs":

- **The vocabulary problem is real.** A clinician looking at a paper on
  myoelectric control of multi-articulating hands has to bridge biomechanics,
  EMG signal processing, machine learning, and clinical fit assessment.
  Generic explanations are not enough; the assistant needs to know that
  `transtibial` means "below-knee amputation", that `AFO` stands for
  ankle-foot orthosis, and that the difference between an active and a
  passive prosthesis matters for outcome interpretation.
- **The literature is heterogeneous.** Trials, simulations, finite-element
  studies, case series, and design papers all coexist. A one-shape-fits-all
  summary fails; a structured summary that explicitly carves out
  *Methodology*, *Findings*, *Limitations*, and *POAR Relevance* is
  substantially more useful for cross-reading.
- **Comparison is the actual research workflow.** A graduate student doing a
  systematic review will spend most of their time comparing methodologies
  and reconciling contradictions. Tooling for this is exactly what is
  missing from the existing AI-research-assistant landscape.

## Prosthetics, orthotics, and assistive-robotics context

The app is opinionated about the field:

- A **controlled tag vocabulary** spans Prosthetics, Orthotics, Robotics,
  Neurorehabilitation, Biomechanics, Sensors & Control, Clinical Context,
  and Methods. Acronyms (BCI, FES, IMU, sEMG, MPC, RL, SEA, AFO, KAFO,
  TLSO, ...) all normalise to canonical slugs at extraction time so multi-domain
  papers tag consistently.
- The **system prompt** every Claude call shares anchors the assistant in
  POAR domain knowledge: device classes, amputation levels, sensors, control
  laws, outcome measures (PEQ, LCI, AMP, 6MWT, SF-36).
- Structured summaries always include a dedicated **POAR Relevance** section
  calling out what the paper specifically contributes to prosthetics /
  orthotics / assistive-robotics practice or design.
- The **Compare** workflow surfaces methodology, participants, outcome
  measures, devices and sensors, rehab approach, strengths, weaknesses, and
  clinical implications side by side; it then scores similarity 0-1 and tags
  one paper as stronger when one clearly is.

The historical industry term "P&O" / "O&P" is preserved verbatim inside any
quoted scientific text - we only updated the project identity to POAR.

## AI engineering challenges solved

| Challenge | Solution |
| --- | --- |
| **Citations that survive a reload** | Numbered chunk registry stored alongside each generation; UI re-resolves at read time. The model is never on the critical path of resolving a `[3]`. |
| **Streaming chat with structured side-channel data** | Vercel AI SDK's `createDataStreamResponse` + `data` annotations interleaved with the text stream; the UI shows clickable `[n]` badges as the answer arrives. |
| **Schema-enforced structured outputs** | `generateObject` + Zod across all three structured-analysis features. Rejected fields, hallucinated citation refs, out-of-vocabulary tags all dropped silently rather than producing broken UI. |
| **Per-user RLS that covers DB + Storage** | One `using (auth.uid() = user_id)` policy per table; Storage policies on the leading folder name. Anon-key browser client is safe. |
| **Hybrid search without a magic alpha** | Reciprocal Rank Fusion of vector NN and `tsvector` FTS in a single Postgres function. |
| **Versioned regeneration** | Composite `(scope, version)` unique key; latest non-archived is "current"; older versions reachable from a Versions list. |
| **Realtime status without polling** | `papers` added to `supabase_realtime`; library subscribes to `postgres_changes`. |
| **Title generation that does not stall the UI** | Auto-title runs in `onFinish` after the first turn; pushed back as a second `data` annotation; the URL `replace` only fires after `isLoading` is false to avoid killing the stream. |
| **Acronym normalisation** | Typed `TagDef` array with `aliases?`; `normalizeTag()` lookup table built at module load handles slug / alias / raw acronym / un-hyphenated forms. |
| **PDF text extraction in serverless** | `unpdf` (no native deps) + post-processing (hyphenation merge, whitespace collapse). |
| **Cloudflare-compatible Next deploy** | `@opennextjs/cloudflare` adapter + `nodejs_compat` flag; `wrangler.toml` declares the production custom domain in code. |

## Technical complexity

Concrete numbers:

- 5 Postgres migrations defining 7 tables, 10+ indexes, 4 RPCs (one HNSW
  vector NN, one RRF hybrid search, two FTS unions for chat + analyses
  history).
- 3 LLM-backed structured-output schemas (Summary 7 sections, Terminology
  extracts 15-30 typed terms with three explanations each, Comparison 8
  side-by-side fields + contradictions).
- ~25 typed React/Next route handlers + server pages.
- Hand-rolled UI primitives (Tabs, Collapsible, Drawer, Skeleton) chosen
  over a Radix install to keep the bundle small.
- Citation system that works **across reload**: every cited claim in every
  saved artifact remains link-functional indefinitely.
- Pagination via real keyset cursors (not offset).
- Single deployable: Cloudflare Worker via OpenNext.

## What was learned

**Streaming + structured side-channel data is harder than streaming alone.**
Getting `[n]` badges to render *as the answer streams* required careful
sequencing: emit the citations annotation **before** the text starts, persist
the user turn before streaming, gate the post-stream URL change on
`isLoading=false` to avoid killing the connection. Each of these is a small
trap that does not show up until you try it.

**Structured outputs with Zod change how you write prompts.** Once Claude is
guaranteed to return a typed object, the prompt simplifies dramatically -
no more "format your output as JSON" ceremony. The remaining work is field
descriptions and hard rules ("cite at least one chunk per field"). Hallucinated
out-of-range citation refs are easy to handle (drop them on resolve), so the
model can be a little fuzzy without producing broken UI.

**RLS at every layer pays off immediately.** Writing the policies up front
meant no API route ever needed an `if (row.user_id !== user.id)` check. New
tables added during the chat-history and analyses milestones each took one
`CREATE POLICY` line to be safe.

**Versioning is cheaper than diff UIs.** Storing every regeneration as a new
row was a one-line schema decision. Building a sophisticated diff UI for
"compare versions" would be substantial. The data is there when we want it.

**Hybrid search makes the vector store a feature, not a primitive.** A
vector store on its own answers semantic queries; a hybrid Postgres function
that fuses vector + FTS in one RPC under RLS feels like a database feature.
This is what pgvector + RRF buys.

**Cloudflare's CPU limits are a real design constraint, not a footnote.**
Designing the ingestion pipeline as an inline route was correct for the
MVP, but documenting the queue migration in the roadmap from day 1 - and
not pretending the constraint would not bite at scale - is the kind of
honesty that makes the roadmap usable.

**Domain opinionatedness is the differentiator.** A controlled vocabulary, a
domain primer in every prompt, a section in every summary that names POAR
relevance specifically - these are small details that make the assistant
feel like a domain tool rather than a generic wrapper.

## Where to read more

- High-level architecture: [`docs/architecture/system-overview.md`](../architecture/system-overview.md)
- The data model in detail: [`docs/database/schema.md`](../database/schema.md)
- The RAG pipeline end-to-end: [`docs/rag-pipeline/retrieval-flow.md`](../rag-pipeline/retrieval-flow.md)
- Why every meaningful design decision was made the way it was: [`docs/engineering/decisions.md`](../engineering/decisions.md)
- What is on deck next: [`docs/roadmap/future-features.md`](../roadmap/future-features.md)
