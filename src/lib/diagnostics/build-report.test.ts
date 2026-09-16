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
    date_signed: "date_signed" in overrides ? overrides.date_signed! : "2025-06-01",
    date_published: "date_published" in overrides ? overrides.date_published! : "2025-06-02",
    needs_review: overrides.needs_review ?? false,
    review_reason: overrides.review_reason ?? null,
  };
}

describe("buildDiagnosticsReport — duplicate instruments", () => {
  it("catches two rows recording the same instrument when neither has an EO number", () => {
    // The shape of all 62 duplicates merged on 2026-09-16: a proclamation
    // recorded once from the spreadsheet and once from the Federal Register.
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "legacy", eo_number: null, title: "National Donate Life Month, 2025", date_signed: "2025-04-03" }),
        makeRow({ id: "ingested", eo_number: null, title: "National Donate Life Month, 2025", date_signed: "2025-04-03" }),
      ],
      TODAY,
    );

    expect(report.duplicateEoNumbers).toEqual([]); // invisible to the EO-number check
    expect(report.duplicateInstruments).toHaveLength(1);
    expect(report.duplicateInstruments[0].ids).toEqual(["legacy", "ingested"]);
  });

  it("matches across casing differences in the title", () => {
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "a", eo_number: null, title: "Regulatory Relief To Promote American Energy", date_signed: "2025-07-17" }),
        makeRow({ id: "b", eo_number: null, title: "Regulatory Relief to Promote American Energy", date_signed: "2025-07-17" }),
      ],
      TODAY,
    );

    expect(report.duplicateInstruments).toHaveLength(1);
  });

  it("does not report two same-titled orders signed on different dates", () => {
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "eo-14310", title: "Further Extending the TikTok Enforcement Delay", date_signed: "2025-06-19" }),
        makeRow({ id: "eo-14350", title: "Further Extending the TikTok Enforcement Delay", date_signed: "2025-09-16" }),
      ],
      TODAY,
    );

    expect(report.duplicateInstruments).toEqual([]);
  });

  it("skips rows with no signing date rather than matching them on title alone", () => {
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "a", title: "Same Title", date_signed: null }),
        makeRow({ id: "b", title: "Same Title", date_signed: null }),
      ],
      TODAY,
    );

    expect(report.duplicateInstruments).toEqual([]);
  });

  it("reports nothing for a clean corpus", () => {
    const report = buildDiagnosticsReport(
      [
        makeRow({ id: "a", title: "One Order", date_signed: "2025-04-03" }),
        makeRow({ id: "b", title: "Another Order", date_signed: "2025-04-03" }),
      ],
      TODAY,
    );

    expect(report.duplicateInstruments).toEqual([]);
  });
});

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
