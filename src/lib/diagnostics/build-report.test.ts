import { describe, expect, it } from "vitest";
import { buildDiagnosticsReport, type DiagnosticsRow } from "@/lib/diagnostics/build-report";

const TODAY = new Date("2026-09-08T00:00:00Z");

// "field" in overrides (rather than ?? overrides.field) so an explicit
// `field: null` override — needed to test a genuinely missing date — is
// honored instead of silently falling back to the default.
function makeRow(overrides: Partial<DiagnosticsRow> & { id: string }): DiagnosticsRow {
  return {
    id: overrides.id,
    eo_number: "eo_number" in overrides ? overrides.eo_number! : `EO ${overrides.id}`,
    title: overrides.title ?? "Some Order",
    date_signed: overrides.date_signed ?? "2025-06-01",
    date_published: "date_published" in overrides ? overrides.date_published! : "2025-06-02",
    needs_review: overrides.needs_review ?? false,
    review_reason: overrides.review_reason ?? null,
  };
}

describe("buildDiagnosticsReport", () => {
  it("reports total row count", () => {
    const report = buildDiagnosticsReport([makeRow({ id: "1" }), makeRow({ id: "2" })], TODAY);
    expect(report.totalRows).toBe(2);
  });

  it("surfaces a date-sanity failure even when needs_review was never set", () => {
    const report = buildDiagnosticsReport([makeRow({ id: "1", date_signed: "2029-09-29", needs_review: false })], TODAY);
    expect(report.dateSanityFailures).toHaveLength(1);
    expect(report.dateSanityFailures[0].eoNumber).toBe("EO 1");
    expect(report.dateSanityFailures[0].reason).toContain("future");
  });

  it("finds duplicate eo_numbers across the full table, not just unlinked rows", () => {
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "1", eo_number: "EO 14166" }),
        makeRow({ id: "2", eo_number: "EO 14166" }),
        makeRow({ id: "3", eo_number: "EO 14217" }),
      ],
      TODAY,
    );
    expect(report.duplicateEoNumbers).toEqual(["EO 14166"]);
  });

  it("ignores rows with no eo_number when checking for duplicates", () => {
    const report = buildDiagnosticsReport(
      [makeRow({ id: "1", eo_number: null }), makeRow({ id: "2", eo_number: null })],
      TODAY,
    );
    expect(report.duplicateEoNumbers).toEqual([]);
  });

  it("reports prior-administration holdovers separately from date-sanity failures", () => {
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "1", eo_number: "EO 14145", date_signed: "2025-01-19", date_published: "2025-01-24" }),
        makeRow({ id: "2", eo_number: "EO 14200", date_signed: "2025-06-01", date_published: "2025-06-02" }),
      ],
      TODAY,
    );
    expect(report.priorAdministrationHoldovers).toEqual([{ id: "1", eoNumber: "EO 14145" }]);
    expect(report.dateSanityFailures).toHaveLength(0);
  });

  it("still counts an unexplained pre-start date_signed as a date-sanity failure, not merely a holdover", () => {
    const report = buildDiagnosticsReport(
      [makeRow({ id: "1", eo_number: null, date_signed: "2025-01-18", date_published: null })],
      TODAY,
    );
    expect(report.dateSanityFailures).toHaveLength(1);
    expect(report.priorAdministrationHoldovers).toEqual([{ id: "1", eoNumber: null }]);
  });

  it("tallies needs_review rows by category, ignoring rows not flagged", () => {
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "1", needs_review: true, review_reason: "EO 14232 appears on more than one legacy row." }),
        makeRow({ id: "2", needs_review: true, review_reason: "No Federal Register Executive Order document found." }),
        makeRow({ id: "3", needs_review: false, review_reason: null }),
      ],
      TODAY,
    );
    expect(report.needsReviewTotal).toBe(2);
    expect(report.needsReviewByCategory.duplicate_eo_number).toBe(1);
    expect(report.needsReviewByCategory.no_fr_match).toBe(1);
  });
});
