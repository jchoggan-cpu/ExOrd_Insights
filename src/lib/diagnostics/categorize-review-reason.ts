// Buckets the free-text review_reason strings this codebase writes (across
// sync.ts, reconcile-legacy.ts, date-sanity.ts, enrich-job.ts) into a fixed
// set of categories for reporting — matched by the distinctive phrase each
// call site uses, so a new phrase always falls into "other" instead of
// silently miscategorizing.
export type ReviewReasonCategory =
  | "duplicate_eo_number"
  | "no_fr_match"
  | "low_title_similarity"
  | "date_corrected"
  | "date_sanity_future"
  | "date_sanity_pre_admin"
  | "date_sanity_published_before_signed"
  | "correction_conflicts_with_manual_edit"
  | "unlinked_legacy_row_detected_by_ingest"
  | "ai_quote_unverified"
  | "other";

const MATCHERS: [string, ReviewReasonCategory][] = [
  ["appears on more than one legacy row", "duplicate_eo_number"],
  ["No Federal Register Executive Order document found", "no_fr_match"],
  ["doesn't line up confidently enough", "low_title_similarity"],
  ["auto-corrected from the legacy value", "date_corrected"],
  ["is in the future", "date_sanity_future"],
  ["is before the administration's start date", "date_sanity_pre_admin"],
  ["Federal Register never publishes before signing", "date_sanity_published_before_signed"],
  ["has already been manually edited", "correction_conflicts_with_manual_edit"],
  ["isn't linked yet", "unlinked_legacy_row_detected_by_ingest"],
  ["not found verbatim in the stored full text", "ai_quote_unverified"],
];

export function categorizeReviewReason(reason: string | null): ReviewReasonCategory | null {
  if (!reason) return null;
  for (const [phrase, category] of MATCHERS) {
    if (reason.includes(phrase)) return category;
  }
  return "other";
}
