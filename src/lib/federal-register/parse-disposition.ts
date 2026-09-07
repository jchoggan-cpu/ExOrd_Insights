import type { EoStatus } from "@/lib/types";

export interface ParsedDisposition {
  status: EoStatus;
  /** Related EO numbers referenced in the notes, e.g. ["EO 13961", "EO 14239"]. */
  relatedEoNumbers: string[];
}

// Federal Register writes disposition_notes/executive_order_notes as short
// freetext lines, e.g. "Revokes in part: EO 13961, December 7, 2020" — this
// is the only pattern confirmed against a live example so far. The other
// prefixes below (Amends, Superseded by, Continued by) are defensive
// guesses at likely siblings, not yet observed — an unrecognized line still
// contributes its EO-number references but never changes status away from
// the safe default ("active"), so an unfamiliar format can't cause a
// misclassification.
const FULLY_REVOKED = /^Revokes:/i;
const PARTIALLY_REVOKED_OR_AMENDED = /^(Revokes in part|Amends|Amended by|Superseded by|Continued by):/i;
const EO_NUMBER = /EO\s+(\d+)/gi;

/**
 * Parses a presidential document's disposition notes into a status and any
 * related EO numbers. Returns "active" with no related orders for null/empty
 * notes (the common case) or any line that doesn't match a known pattern.
 */
export function parseDispositionNotes(notes: string | null): ParsedDisposition {
  if (!notes) {
    return { status: "active", relatedEoNumbers: [] };
  }

  const lines = notes
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  let status: EoStatus = "active";
  const relatedEoNumbers = new Set<string>();

  for (const line of lines) {
    for (const match of line.matchAll(EO_NUMBER)) {
      relatedEoNumbers.add(`EO ${match[1]}`);
    }

    if (FULLY_REVOKED.test(line)) {
      status = "revoked";
    } else if (PARTIALLY_REVOKED_OR_AMENDED.test(line) && status !== "revoked") {
      status = "amended";
    }
  }

  return { status, relatedEoNumbers: [...relatedEoNumbers] };
}
