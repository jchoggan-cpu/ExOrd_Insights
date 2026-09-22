import type { EoStatus } from "@/lib/types";

export interface ParsedDisposition {
  status: EoStatus;
  /** Related EO numbers referenced in the notes, e.g. ["EO 13961", "EO 14239"]. */
  relatedEoNumbers: string[];
}

/*
 * Federal Register writes disposition_notes as short freetext lines. The
 * thing that matters, and that the first version of this file got backwards,
 * is VOICE.
 *
 * "Revokes: EO 14036" on EO 14337 means 14337 revoked 14036. It says nothing
 * about 14337's own status -- 14337 is the instrument doing the revoking and
 * is very much in force. Reading that as "this order is revoked" marked all
 * 24 revoking orders as revoked, including "Protecting the American People
 * Against Invasion", while "Addressing Risks From Paul Weiss", whose notes
 * say "Revoked by: EO 14244", stayed active because no pattern matched it.
 *
 * So: only the PASSIVE forms change this document's status. The active forms
 * describe what this document did to others, and are collected as related EO
 * numbers but otherwise ignored here.
 *
 * The vocabulary below is every line prefix that actually occurs across the
 * live corpus, counted rather than guessed:
 *
 *   148  See:                       neutral cross-reference
 *    24  Revokes:                   active
 *    17  Amends:                    active
 *     8  Amended by:                PASSIVE -> amended
 *     3  Continued by:              PASSIVE -> still in force, so no change
 *     2  Rescinds:                  active
 *     2  Supersedes (in part):      active
 *     2  Reinstates:                active
 *     1  Supersedes:                active
 *     1  Revokes in part:           active
 *     1  Superseded by (in part):   PASSIVE -> amended
 *     1  Continues:                 active
 *     1  Superseded by:             PASSIVE -> revoked
 *     1  Revoked by:                PASSIVE -> revoked
 *
 * An unrecognized line still contributes its EO-number references but never
 * changes status away from the safe default, so a new format cannot cause a
 * misclassification -- it can only cause a missed one, which is the right
 * way round for a tracker a law firm reads.
 */

/** Passive, and total: this document is no longer operative. */
const REVOKED_BY = /^(Revoked by|Superseded by):/i;

/**
 * Passive, and partial: this document still stands, changed. "Continued by"
 * is deliberately NOT here -- being continued means still in force, which is
 * "active", not a downgrade.
 */
const AMENDED_BY = /^(Amended by|Superseded by \(in part\)|Revoked by \(in part\)):/i;

const EO_NUMBER = /EO\s+(\d+)/gi;

/**
 * Parses a presidential document's disposition notes into a status for THAT
 * document and any related EO numbers. Returns "active" with no related
 * orders for null/empty notes (the common case) or any line that doesn't
 * match a known pattern.
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

    // Checked before the partial form, since "Superseded by (in part)" also
    // starts with "Superseded by" and must not be read as a full revocation.
    if (AMENDED_BY.test(line)) {
      if (status !== "revoked") status = "amended";
    } else if (REVOKED_BY.test(line)) {
      status = "revoked";
    }
  }

  return { status, relatedEoNumbers: [...relatedEoNumbers] };
}
