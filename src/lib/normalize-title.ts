/**
 * Reducing an instrument's title to a form two records can be compared on.
 *
 * Shared by the duplicate merge (src/lib/merge/), the ingestion guard that
 * stops new duplicates being created (federal-register/find-unlinked-legacy.ts)
 * and the diagnostics report — all three have to agree on what "the same
 * title" means, or a pair one of them considers matched is invisible to
 * another.
 *
 * Deliberately not fuzzy. Case, punctuation and whitespace are noise
 * ("Regulatory Relief for certain stationary sources" is the same title as
 * "Regulatory Relief for Certain Stationary Sources"), but two titles
 * differing by an actual word are two different documents, and a human
 * should look at them rather than have code decide.
 */
export function normalizeTitle(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

/**
 * The key two records must share to be considered the same instrument:
 * normalized title AND signing date, never title alone.
 *
 * "Further Extending the TikTok Enforcement Delay" is the title of two
 * genuinely different orders — EO 14310 signed 2025-06-19 and EO 14350
 * signed 2025-09-16. A title-only rule would collapse them into one and
 * lose a real order.
 */
export function instrumentKey(title: string, dateSigned: string): string {
  return `${normalizeTitle(title)}|${dateSigned}`;
}
