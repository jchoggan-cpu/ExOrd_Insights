import { describe, expect, it } from "vitest";
import { categorizeReviewReason } from "@/lib/diagnostics/categorize-review-reason";

describe("categorizeReviewReason", () => {
  it("returns null for no reason", () => {
    expect(categorizeReviewReason(null)).toBeNull();
  });

  it("categorizes a duplicate eo_number reason", () => {
    expect(categorizeReviewReason("EO 14232 appears on more than one legacy row still awaiting reconciliation — resolve by hand.")).toBe(
      "duplicate_eo_number",
    );
  });

  it("categorizes a no-FR-match reason", () => {
    expect(categorizeReviewReason("No Federal Register Executive Order document found for EO 40223 in range.")).toBe(
      "no_fr_match",
    );
  });

  it("categorizes a low-title-similarity reason", () => {
    expect(
      categorizeReviewReason("Backfill matched EO 14217 to Federal Register document 2025-03133 but the title doesn't line up confidently enough to auto-reconcile."),
    ).toBe("low_title_similarity");
  });

  it("categorizes a date-corrected reason", () => {
    expect(
      categorizeReviewReason("date_signed auto-corrected from the legacy value (2029-09-29) to Federal Register's 2025-09-29 — verify."),
    ).toBe("date_corrected");
  });

  it("categorizes each date-sanity reason distinctly", () => {
    expect(categorizeReviewReason("date_signed (2029-09-29) is in the future.")).toBe("date_sanity_future");
    expect(
      categorizeReviewReason("date_signed (2025-01-19) is before the administration's start date (2025-01-20)."),
    ).toBe("date_sanity_pre_admin");
    expect(
      categorizeReviewReason("date_published (2025-09-20) is before date_signed (2025-09-29) — Federal Register never publishes before signing."),
    ).toBe("date_sanity_published_before_signed");
  });

  it("categorizes a manual-edit conflict reason", () => {
    expect(
      categorizeReviewReason("Federal Register correction 2026-1 would change title, which has already been manually edited — left unchanged pending review."),
    ).toBe("correction_conflicts_with_manual_edit");
  });

  it("categorizes an unlinked-legacy-row reason", () => {
    expect(
      categorizeReviewReason("Federal Register document 2025-1 matches this row's eo_number (EO 14421) but isn't linked yet."),
    ).toBe("unlinked_legacy_row_detected_by_ingest");
  });

  it("categorizes an AI-quote-unverified reason", () => {
    expect(
      categorizeReviewReason('AI summary contained a quote not found verbatim in the stored full text: "foo"'),
    ).toBe("ai_quote_unverified");
  });

  it("falls back to other for an unrecognized reason", () => {
    expect(categorizeReviewReason("Something new nobody has written a matcher for yet.")).toBe("other");
  });
});
