/**
 * Pure helpers shared between `evals/run.ts` and the unit tests in
 * `tests/evals/`. We keep them here (as a library export) instead of
 * importing them out of the CLI script so:
 *   - the script stays a single, copy-pasteable file with zero src/ imports;
 *   - we can unit-test the metrics independently of an HTTP target.
 *
 * If you change a function here you MUST mirror the change in `evals/run.ts`.
 * The two are kept in lockstep on purpose — duplicating ~30 lines of pure
 * logic is cheaper than threading an `@/` alias through the CLI.
 */

const REFUSAL_RE =
  /(no\s+(relevant\s+)?context|i\s+don't\s+have|not\s+(in\s+the\s+)?context|cannot\s+find|no\s+information|nothing\s+(relevant|in\s+(your\s+)?library)|(unable|cannot)\s+to\s+answer|do\s+not\s+have|i'?m\s+not\s+sure)/i;

export function detectRefusal(text: string, citationsUsed: number): boolean {
  if (!text) return true;
  if (citationsUsed === 0 && text.length < 600) return true;
  return REFUSAL_RE.test(text);
}

export function answerMatches(answer: string, needles: string[] | undefined): boolean {
  if (!needles || needles.length === 0) return true;
  const a = answer.toLowerCase();
  return needles.some((n) => a.includes(n.toLowerCase()));
}

export function retrievalHit(
  citations: { snippet: string }[],
  keywords: string[] | undefined
): boolean {
  if (!keywords || keywords.length === 0) return citations.length > 0;
  const blob = citations.map((c) => c.snippet).join("\n").toLowerCase();
  return keywords.some((k) => blob.includes(k.toLowerCase()));
}

export function percentile(values: number[], p: number): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const i = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[i];
}
