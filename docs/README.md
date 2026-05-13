# POAR Research Assistant - Documentation

Engineering and product documentation for the POAR (Prosthetics, Orthotics, and
Assistive Robotics) Research Assistant.

The repo-level [`README.md`](../README.md) is the entry point for users and
recruiters. The docs in this folder are for engineers maintaining or extending
the project.

## Index

### Architecture
- [System overview](architecture/system-overview.md) - components, data flow, auth, ingest, chat, structured analyses, realtime.

### Database
- [Schema reference](database/schema.md) - every table, column, RLS policy, index, RPC, and storage bucket. Explains why pgvector and why hybrid search.

### RAG pipeline
- [Retrieval flow](rag-pipeline/retrieval-flow.md) - PDF parsing, chunking strategy, embeddings, retrieval, citation resolution, Claude answer generation, with tradeoffs called out.

### Features
- [Library](features/library.md)
- [Chat](features/chat.md)
- [Structured summaries](features/structured-summaries.md)
- [Terminology mode](features/terminology.md)
- [Compare papers](features/compare-papers.md)
- [Research history](features/research-history.md)

### Deployment
- [Cloudflare Pages walkthrough](deployment/cloudflare-pages.md) - setup, env vars, secrets, custom domain, Supabase auth wiring, troubleshooting.

### Engineering
- [Architecture decision records](engineering/decisions.md) - the trade-offs behind the stack, every "why X over Y" decision the project made.

### Roadmap
- [Future features](roadmap/future-features.md) - OCR fallback, Zotero, notes, collaborative research, AI recommendations, paper graph, terminology knowledge graph.

### Portfolio
- [Project summary](portfolio/project-summary.md) - narrative of goals, biomedical relevance, AI engineering challenges, complexity, and learnings. Suitable for portfolios, applications, and interviews.

## Conventions

- One H1 per file. The H1 is the document title.
- Mermaid diagrams instead of ASCII art when there is non-trivial structure.
- Code references use the project's relative paths (e.g. `src/lib/...`).
- Database identifiers use the back-tick `code` style.
- Each feature doc has the same four-section shape: **Purpose**, **UX flow**, **Technical implementation**, **Future improvements**.
- Each ADR in [`engineering/decisions.md`](engineering/decisions.md) has the same structure: **Context**, **Options**, **Decision**, **Consequences**.
