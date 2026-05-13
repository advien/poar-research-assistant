import { resolveCitationRefs } from "./paperContext";
import type { ResolvedSummary } from "./generateSummary";
import { normaliseCategory, type ResolvedTerm } from "./generateTerminology";
import type { StructuredSummaryT, TerminologyExtractionT, PaperComparisonT } from "./schemas";
import type { Citation, ComparisonRow } from "@/types/db";

/** Re-derive resolved citation arrays from a stored payload + citation registry. */
export function resolveStoredSummary(
  payload: StructuredSummaryT,
  registry: Citation[]
): ResolvedSummary {
  return {
    abstract_summary: {
      text: payload.abstract_summary.text,
      citations: resolveCitationRefs(payload.abstract_summary.citations, registry),
    },
    key_methodology: {
      items: payload.key_methodology.items,
      citations: resolveCitationRefs(payload.key_methodology.citations, registry),
    },
    main_findings: {
      items: payload.main_findings.items,
      citations: resolveCitationRefs(payload.main_findings.citations, registry),
    },
    limitations: {
      items: payload.limitations.items,
      citations: resolveCitationRefs(payload.limitations.citations, registry),
    },
    clinical_relevance: {
      text: payload.clinical_relevance.text,
      citations: resolveCitationRefs(payload.clinical_relevance.citations, registry),
    },
    po_relevance: {
      text: payload.po_relevance.text,
      citations: resolveCitationRefs(payload.po_relevance.citations, registry),
    },
    future_directions: {
      items: payload.future_directions.items,
      citations: resolveCitationRefs(payload.future_directions.citations, registry),
    },
  };
}

export function resolveStoredTerminology(
  payload: TerminologyExtractionT,
  registry: Citation[]
): ResolvedTerm[] {
  return payload.terms.map((t) => ({
    term: t.term,
    category: normaliseCategory(t.category),
    expansion: t.expansion ?? null,
    pronunciation: t.pronunciation ?? null,
    beginner_explanation: t.beginner_explanation,
    technical_explanation: t.technical_explanation,
    clinical_context: t.clinical_context,
    citations: resolveCitationRefs(t.citations ?? [], registry),
  }));
}

/** For comparisons: refs are strings like "A3" or "B7". Resolve from the
 *  prefixed registry stored on ComparisonRow.citations. */
export function resolveComparisonRefs(
  refs: string[] | undefined,
  registry: ComparisonRow["citations"]
): ComparisonRow["citations"] {
  if (!refs || refs.length === 0) return [];
  const map = new Map(registry.map((r) => [r.ref, r]));
  const out: ComparisonRow["citations"] = [];
  const seen = new Set<string>();
  for (const r of refs) {
    if (seen.has(r)) continue;
    seen.add(r);
    const hit = map.get(r);
    if (hit) out.push(hit);
  }
  return out;
}

export function resolvedComparison(payload: PaperComparisonT, registry: ComparisonRow["citations"]) {
  const r = (refs: string[] | undefined) => resolveComparisonRefs(refs, registry);
  return {
    methodology: { ...payload.methodology, citations: r(payload.methodology.citations) },
    participants: { ...payload.participants, citations: r(payload.participants.citations) },
    outcome_measures: { ...payload.outcome_measures, citations: r(payload.outcome_measures.citations) },
    devices_sensors: { ...payload.devices_sensors, citations: r(payload.devices_sensors.citations) },
    rehabilitation_approach: {
      ...payload.rehabilitation_approach,
      citations: r(payload.rehabilitation_approach.citations),
    },
    strengths: { ...payload.strengths, citations: r(payload.strengths.citations) },
    weaknesses: { ...payload.weaknesses, citations: r(payload.weaknesses.citations) },
    clinical_implications: { ...payload.clinical_implications, citations: r(payload.clinical_implications.citations) },
    contradictions: payload.contradictions.map((c) => ({ ...c, citations: r(c.citations) })),
    similarity_score: payload.similarity_score,
    stronger_paper: payload.stronger_paper,
    overall_assessment: { ...payload.overall_assessment, citations: r(payload.overall_assessment.citations) },
  };
}
