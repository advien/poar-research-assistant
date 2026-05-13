import { z } from "zod";
import { generateObject } from "ai";
import { chatModel } from "@/lib/ai/anthropic";
import { METADATA_SYSTEM_PROMPT } from "@/lib/ai/prompts";
import {
  CATEGORY_LABELS,
  CATEGORY_ORDER,
  TAGS_BY_CATEGORY,
  dedupeAndNormalizeTags,
  TAG_VOCABULARY,
} from "@/lib/tags";
import type { ParsedPage } from "./parsePdf";

export const PaperMetadata = z.object({
  title: z.string().nullable(),
  authors: z.array(z.string()).default([]),
  journal: z.string().nullable(),
  year: z.number().int().min(1800).max(2100).nullable(),
  doi: z.string().nullable(),
  abstract: z.string().nullable(),
  tags: z.array(z.string()).default([]),
});

export type PaperMetadataT = z.infer<typeof PaperMetadata>;

export async function extractMetadata(pages: ParsedPage[]): Promise<PaperMetadataT> {
  const head = pages
    .slice(0, 3)
    .map((p) => `--- page ${p.page} ---\n${p.text}`)
    .join("\n\n")
    .slice(0, 12000);

  const vocabularyBlock = renderVocabularyForPrompt();
  const aliasBlock = renderAliasHints();

  const { object } = await generateObject({
    model: chatModel,
    schema: PaperMetadata,
    system: METADATA_SYSTEM_PROMPT,
    prompt: `Extract bibliographic metadata from the first pages of this paper. The paper is from
the prosthetics, orthotics, and assistive / rehabilitation robotics literature.

Choose 3-7 tags STRICTLY from the controlled vocabulary below (lower-case, hyphenated). A
single paper may legitimately span multiple categories - tag accordingly.

${vocabularyBlock}

When the paper uses an acronym, prefer the canonical full-form slug from the table above. The
following acronym mappings apply:

${aliasBlock}

If a field is unknown, use null (or [] for arrays). Return JSON only.

PAGES:
${head}`,
  });

  // Normalise everything Claude returned: maps acronyms / synonyms to canonical
  // slugs, drops anything outside the vocabulary, dedupes.
  object.tags = dedupeAndNormalizeTags(object.tags ?? []);
  return object;
}

// =============================================================================
// helpers
// =============================================================================

/** Render the vocabulary as a category-organised bullet list for the prompt. */
function renderVocabularyForPrompt(): string {
  return CATEGORY_ORDER.map((cat) => {
    const tags = TAGS_BY_CATEGORY[cat];
    if (!tags.length) return null;
    return `${CATEGORY_LABELS[cat]}: ${tags.map((t) => t.slug).join(", ")}`;
  })
    .filter(Boolean)
    .join("\n");
}

/** Pick out the most useful acronym/alias mappings as inline hints for Claude. */
function renderAliasHints(): string {
  const lines: string[] = [];
  for (const t of TAG_VOCABULARY) {
    const aliases = t.aliases ?? [];
    if (aliases.length === 0) continue;
    // Compact: "BCI -> brain-computer-interface (also BMI, brain-machine-interface)"
    const head = aliases[0].toUpperCase();
    const rest = aliases.slice(1);
    const suffix = rest.length ? ` (also ${rest.join(", ")})` : "";
    lines.push(`- ${head} -> ${t.slug}${suffix}`);
  }
  return lines.join("\n");
}
