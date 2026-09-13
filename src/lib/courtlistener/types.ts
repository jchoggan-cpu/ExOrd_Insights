/**
 * The subset of CourtListener's RECAP search result this project reads.
 * Field names are CourtListener's own (snake_case and camelCase mixed —
 * that's their API, not a convention slip here).
 */
export interface CourtListenerDocket {
  caseName: string;
  court_id: string;
  court_citation_string: string;
  docketNumber: string;
  dateFiled: string | null;
  dateTerminated: string | null;
  /** Site-relative, e.g. "/docket/69742076/jgg-v-trump/". */
  docket_absolute_url: string;
  docket_id: number;
  assignedTo: string | null;
}

/**
 * What the matcher decided about one of the firm's legal_challenges entries.
 *
 * Deliberately three outcomes, never two: a case the firm recorded may have
 * been renamed, may share its name with several real dockets, or may simply
 * not be in RECAP. Forcing those into "matched" is how a wrong docket link
 * ends up in front of an attorney, so they are kept separate and the
 * uncertain ones are handed back to a human.
 */
export type MatchOutcome = "confident" | "ambiguous" | "not_found";

export interface DocketMatch {
  outcome: MatchOutcome;
  /** Set only when outcome is "confident". */
  docket?: CourtListenerDocket;
  /** Every candidate that survived filtering — what a human reviews for "ambiguous". */
  candidates: CourtListenerDocket[];
  /** Plain-English account of why this outcome was reached, for the review file. */
  reason: string;
}
