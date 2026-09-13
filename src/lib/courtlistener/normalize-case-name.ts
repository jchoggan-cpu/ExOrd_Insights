/**
 * Reduces a case name to a comparison form, and splits it into its two
 * sides. One job: making "Doe v. Noem", "DOE v. NOEM", and "Doe vs. Noem, et
 * al." comparable, without deciding whether two names refer to the same case
 * — that judgment belongs to match-case.ts.
 */

// "et al", "et al.", ", et al." — noise on either side of the v.
const ET_AL = /,?\s*\bet\s+al\.?/gi;
// The separator, however it's written: "v.", "v", "vs.", "vs".
const VERSUS = /\s+vs?\.?\s+/gi;

/**
 * Lowercased, punctuation-free, single-spaced, with the versus separator
 * normalized to " v ". Returns "" for empty input.
 */
export function normalizeCaseName(caseName: string | null | undefined): string {
  if (!caseName) return "";
  return caseName
    .replace(ET_AL, " ")
    .replace(VERSUS, " v ")
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export interface CaseParties {
  plaintiff: string;
  defendant: string;
}

/**
 * Splits a normalized case name on its first " v ". Returns null when there
 * is no separator (a caption we can't reason about, e.g. "In re Something"),
 * which callers must treat as "not comparable" rather than guessing.
 */
export function splitParties(caseName: string | null | undefined): CaseParties | null {
  const normalized = normalizeCaseName(caseName);
  const at = normalized.indexOf(" v ");
  if (at === -1) return null;

  const plaintiff = normalized.slice(0, at).trim();
  const defendant = normalized.slice(at + 3).trim();
  if (!plaintiff || !defendant) return null;

  return { plaintiff, defendant };
}

/**
 * True when one party string plausibly names the same party as the other:
 * identical, or one is a prefix of the other at a word boundary.
 *
 * The prefix rule exists because the firm abbreviates long institutional
 * plaintiffs ("Las Americas Immigrant Advocacy Center" for CourtListener's
 * fuller caption). It is deliberately a prefix test and not a substring
 * test — "noem" appearing anywhere inside an unrelated caption is not
 * evidence of anything, but a caption *starting* with the recorded party is.
 */
export function partiesLookAlike(a: string, b: string): boolean {
  if (!a || !b) return false;
  if (a === b) return true;
  const [shorter, longer] = a.length <= b.length ? [a, b] : [b, a];
  return longer.startsWith(`${shorter} `);
}
