import { z } from "zod";

// =============================================================================
// Structured Summary
// =============================================================================

const Cited = (description: string) =>
  z.object({
    text: z.string().describe(description),
    citations: z.array(z.number().int().positive()).default([]),
  });

const CitedList = (description: string) =>
  z.object({
    items: z.array(z.string()).describe(description),
    citations: z.array(z.number().int().positive()).default([]),
  });

export const StructuredSummary = z.object({
  abstract_summary: Cited("2-3 sentence rephrasing of the abstract in plain English."),
  key_methodology: CitedList(
    "3-6 bullet points covering study design, sample, instrumentation, intervention, analysis."
  ),
  main_findings: CitedList(
    "3-5 bullet points stating the principal results with effect direction and magnitudes."
  ),
  limitations: CitedList(
    "Author-stated and reviewer-evident limitations: small sample, controlled lab conditions, short follow-up, etc."
  ),
  clinical_relevance: Cited(
    "Why a clinician (PT/OT/prosthetist/orthotist) should care - 1-2 sentences."
  ),
  // Field key kept as `po_relevance` for storage stability; the surface label
  // used in the UI is "Prosthetics, Orthotics & Assistive Robotics Relevance".
  po_relevance: Cited(
    "What this paper specifically contributes to prosthetics, orthotics, or assistive / rehabilitation robotics practice or design (devices, sockets, exoskeletons, control, sensing, training)."
  ),
  future_directions: CitedList(
    "Concrete next-step research questions or methodological improvements."
  ),
});
export type StructuredSummaryT = z.infer<typeof StructuredSummary>;

// =============================================================================
// Terminology
// =============================================================================

/**
 * NOTE: every field except `term`, `beginner_explanation`,
 * `technical_explanation`, and `clinical_context` is optional / nullable.
 * Claude very occasionally omits an optional field, returns `null` where the
 * schema expects an object, or coins a category that isn't in our taxonomy
 * ("technique", "concept", "phase"). Rejecting the entire 20-term response for
 * one mismatched field would be a terrible UX, so we accept anything plausible
 * here and normalise to canonical values inside the generator.
 */
export const TermCategoryEnum = z.enum([
  "biomechanics",
  "anatomy",
  "device",
  "material",
  "sensor",
  "outcome_measure",
  "method",
  "acronym",
  "other",
]);
export type TermCategory = z.infer<typeof TermCategoryEnum>;

export const Term = z.object({
  term: z.string().min(1),
  category: z.string().min(1).default("other"),
  expansion: z.string().nullable().optional(),
  pronunciation: z.string().nullable().optional(),
  beginner_explanation: z.string().min(1),
  technical_explanation: z.string().min(1),
  clinical_context: z.string().min(1),
  citations: z.array(z.number().int().positive()).nullable().optional(),
});
export type TermT = z.infer<typeof Term>;

export const TerminologyExtraction = z.object({
  terms: z.array(Term).max(40),
});
export type TerminologyExtractionT = z.infer<typeof TerminologyExtraction>;

// =============================================================================
// Compare Papers
// =============================================================================

const CompareCited = (description: string) =>
  z.object({
    a: z.string().describe(`Paper A description: ${description}`),
    b: z.string().describe(`Paper B description: ${description}`),
    citations: z
      .array(z.string().regex(/^[AB]\d+$/, "must be like A1 or B7"))
      .default([]),
  });

export const Contradiction = z.object({
  topic: z.string(),
  paper_a_claim: z.string(),
  paper_b_claim: z.string(),
  citations: z.array(z.string().regex(/^[AB]\d+$/)).default([]),
});

export const PaperComparison = z.object({
  methodology: CompareCited("study design, instruments, analysis approach"),
  participants: CompareCited("sample size, demographics, inclusion criteria"),
  outcome_measures: CompareCited("primary and secondary outcome measures"),
  devices_sensors: CompareCited("hardware, devices, sensors, software used"),
  rehabilitation_approach: CompareCited("intervention type, dosage, setting"),
  strengths: CompareCited("methodological strengths"),
  weaknesses: CompareCited("methodological weaknesses"),
  clinical_implications: CompareCited(
    "translation to prosthetics / orthotics / assistive-robotics / rehabilitation practice"
  ),
  contradictions: z.array(Contradiction).default([]),
  similarity_score: z
    .number()
    .min(0)
    .max(1)
    .describe("0 = different topics, 1 = same study replicated"),
  stronger_paper: z.enum(["a", "b", "tie", "undetermined"]),
  overall_assessment: z
    .object({
      text: z.string(),
      citations: z.array(z.string().regex(/^[AB]\d+$/)).default([]),
    })
    .describe("3-5 sentences justifying the stronger_paper verdict."),
});
export type PaperComparisonT = z.infer<typeof PaperComparison>;
