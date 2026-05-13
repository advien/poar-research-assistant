import { generateObject, NoObjectGeneratedError } from "ai";
import type { SupabaseDbClient } from "@/lib/supabase/server";
import { chatModel, CHAT_MODEL } from "@/lib/ai/anthropic";
import { TERMINOLOGY_SYSTEM } from "./prompts";
import {
  TerminologyExtraction,
  type TerminologyExtractionT,
  type TermT,
  type TermCategory,
} from "./schemas";
import { loadPaperContext, resolveCitationRefs } from "./paperContext";
import type { Citation } from "@/types/db";

/** Resolved term sent to the UI: canonical category + concrete Citation[]. */
export type ResolvedTerm = Omit<TermT, "category" | "citations" | "expansion" | "pronunciation"> & {
  category: TermCategory;
  expansion: string | null;
  pronunciation: string | null;
  citations: Citation[];
};

export type GeneratedTerminology = {
  payload: TerminologyExtractionT & { __searchable: string };
  citations: Citation[];
  resolved: ResolvedTerm[];
  model: string;
};

export async function generateTerminologyExtraction(args: {
  supabase: SupabaseDbClient;
  paperId: string;
}): Promise<GeneratedTerminology> {
  const ctx = await loadPaperContext({ supabase: args.supabase, paperId: args.paperId });
  if (ctx.chunks.length === 0) {
    throw new Error("paper has no extracted chunks - run ingestion first");
  }

  let object: TerminologyExtractionT;
  try {
    const result = await generateObject({
      model: chatModel,
      schema: TerminologyExtraction,
      system: TERMINOLOGY_SYSTEM,
      prompt: `Paper: "${ctx.paper.title ?? "(untitled)"}"

Context chunks:

${ctx.prompt_block}

Extract 15-30 teaching-relevant terms now. For \`category\`, choose ONE of:
biomechanics, anatomy, device, material, sensor, outcome_measure, method, acronym, other.
If unsure, use "other".`,
      temperature: 0.2,
      // 25 terms x ~5 fields x ~80 output tokens each ~= 10000 tokens. The
      // AI SDK default of 4096 is far too low and silently truncates the
      // response, which then fails Zod validation as "terms is undefined".
      maxTokens: 16000,
    });
    object = result.object;
  } catch (e) {
    // The AI SDK throws NoObjectGeneratedError when the model's response does
    // not match the Zod schema. Capture the actual response so we can see what
    // went wrong without round-tripping through dev tools.
    if (NoObjectGeneratedError.isInstance(e)) {
      console.error(
        "[generateTerminologyExtraction] response did not match schema.",
        "\n  cause:",
        e.cause,
        "\n  finishReason:",
        e.finishReason,
        "\n  usage:",
        e.usage,
        "\n  text snippet:",
        typeof e.text === "string" ? e.text.slice(0, 800) : e.text
      );
    } else {
      console.error("[generateTerminologyExtraction] generation failed:", e);
    }
    throw e;
  }

  // Normalise the raw model output into the resolved shape the UI consumes.
  const resolved: ResolvedTerm[] = object.terms.map((t) => ({
    term: t.term,
    category: normaliseCategory(t.category),
    expansion: nonEmpty(t.expansion),
    pronunciation: nonEmpty(t.pronunciation),
    beginner_explanation: t.beginner_explanation,
    technical_explanation: t.technical_explanation,
    clinical_context: t.clinical_context,
    citations: resolveCitationRefs(t.citations ?? [], ctx.citations),
  }));

  // Searchable blob (term names + expansions + categories) backs the FTS index.
  const searchable = resolved
    .map((t) => [t.term, t.expansion ?? "", t.category].filter(Boolean).join(" "))
    .join(" ");

  return {
    payload: { ...object, __searchable: searchable },
    citations: ctx.citations,
    resolved,
    model: CHAT_MODEL,
  };
}

// =============================================================================
// helpers
// =============================================================================

const CANONICAL_CATEGORIES: readonly TermCategory[] = [
  "biomechanics",
  "anatomy",
  "device",
  "material",
  "sensor",
  "outcome_measure",
  "method",
  "acronym",
  "other",
] as const;

const CATEGORY_ALIASES: Record<string, TermCategory> = {
  // canonical pass-through
  biomechanics: "biomechanics",
  anatomy: "anatomy",
  device: "device",
  material: "material",
  sensor: "sensor",
  outcome_measure: "outcome_measure",
  "outcome-measure": "outcome_measure",
  outcomemeasure: "outcome_measure",
  method: "method",
  acronym: "acronym",
  other: "other",
  // common variants Claude reaches for
  technique: "method",
  procedure: "method",
  protocol: "method",
  process: "method",
  approach: "method",
  technology: "device",
  hardware: "device",
  prosthesis: "device",
  orthosis: "device",
  implant: "device",
  signal: "sensor",
  measurement: "outcome_measure",
  metric: "outcome_measure",
  scale: "outcome_measure",
  questionnaire: "outcome_measure",
  abbreviation: "acronym",
  initialism: "acronym",
  concept: "other",
  phase: "other",
  field: "other",
  population: "other",
  condition: "anatomy",
  pathology: "anatomy",
  joint: "anatomy",
  muscle: "anatomy",
};

export function normaliseCategory(raw: string | null | undefined): TermCategory {
  if (!raw) return "other";
  const key = raw.trim().toLowerCase().replace(/\s+/g, "_");
  if ((CANONICAL_CATEGORIES as readonly string[]).includes(key)) {
    return key as TermCategory;
  }
  return CATEGORY_ALIASES[key] ?? "other";
}

function nonEmpty(s: string | null | undefined): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  return trimmed.length > 0 ? trimmed : null;
}
