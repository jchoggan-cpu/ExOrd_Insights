// Shared by the enrich job (verifying an AI summary's quotes against a
// stored executive order's full_text) and the content-drafting assistant
// (verifying a generated draft's quotes against the order(s) it cites).
// Deliberately checks only literal quoted material, never paraphrases —
// a string match can honestly answer "does this appear verbatim?" but not
// "is this paraphrase faithful?", so it doesn't try.

const MIN_QUOTE_LENGTH = 8;
// Matches "straight-quoted" or "curly-quoted" text.
const QUOTED_TEXT = /"([^"]+)"|“([^”]+)”/g;

function normalize(text: string): string {
  return text
    .toLowerCase()
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Returns every quoted substring in `text` (length >= MIN_QUOTE_LENGTH) that
 * does not appear verbatim (whitespace/quote-style normalized) in
 * `sourceText`. An empty array means every quote checked out.
 */
export function findUnverifiedQuotes(text: string, sourceText: string): string[] {
  const normalizedSource = normalize(sourceText);
  const unverified: string[] = [];

  for (const match of text.matchAll(QUOTED_TEXT)) {
    const quoted = match[1] ?? match[2] ?? "";
    if (quoted.length < MIN_QUOTE_LENGTH) continue;
    if (!normalizedSource.includes(normalize(quoted))) {
      unverified.push(quoted);
    }
  }

  return unverified;
}
