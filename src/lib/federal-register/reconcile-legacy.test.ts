import { describe, expect, it } from "vitest";
import {
  applyLegacyReconciliationPlan,
  findDuplicateEoNumbers,
  planLegacyReconciliation,
  type LegacyRow,
} from "@/lib/federal-register/reconcile-legacy";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

function makeDoc(overrides: Partial<FederalRegisterDocument> & { document_number: string }): FederalRegisterDocument {
  return {
    document_number: overrides.document_number,
    title: overrides.title ?? "Some Order",
    subtype: overrides.subtype ?? "Executive Order",
    executive_order_number: overrides.executive_order_number ?? null,
    signing_date: overrides.signing_date ?? "2025-06-01",
    publication_date: overrides.publication_date ?? "2025-06-02",
    citation: overrides.citation ?? "90 FR 1",
    html_url: overrides.html_url ?? `https://www.federalregister.gov/d/${overrides.document_number}`,
    raw_text_url: overrides.raw_text_url ?? `https://www.federalregister.gov/d/${overrides.document_number}.txt`,
    executive_order_notes: overrides.executive_order_notes ?? null,
    disposition_notes: overrides.disposition_notes ?? null,
    correction_of: overrides.correction_of ?? null,
    corrections: overrides.corrections ?? [],
  };
}

function makeRow(overrides: Partial<LegacyRow> & { id: string; eo_number: string }): LegacyRow {
  return {
    id: overrides.id,
    eo_number: overrides.eo_number,
    title: overrides.title ?? "Some Order",
    date_signed: overrides.date_signed ?? "2025-06-01",
  };
}

describe("findDuplicateEoNumbers", () => {
  it("flags an eo_number only when it appears on more than one row", () => {
    const rows = [
      makeRow({ id: "1", eo_number: "EO 14166" }),
      makeRow({ id: "2", eo_number: "EO 14166" }),
      makeRow({ id: "3", eo_number: "EO 14217" }),
    ];
    expect(findDuplicateEoNumbers(rows)).toEqual(new Set(["EO 14166"]));
  });
});

describe("planLegacyReconciliation", () => {
  it("reconciles silently when title matches and the date agrees within the threshold", () => {
    const row = makeRow({ id: "1", eo_number: "EO 14421", title: "Some Order", date_signed: "2025-06-01" });
    const doc = makeDoc({
      document_number: "2025-100",
      executive_order_number: "14421",
      title: "Some Order",
      signing_date: "2025-06-05",
    });

    const [plan] = planLegacyReconciliation([row], [doc]);

    expect(plan.outcome).toBe("reconciled");
    expect(plan.reviewReason).toBeNull();
    expect(plan.matchedDocument).toBe(doc);
  });

  it("adopts Federal Register's date and flags for verification when title matches but the legacy date is wrong — EO 14353's actual bug", () => {
    const row = makeRow({
      id: "legacy-eo-135",
      eo_number: "EO 14353",
      title: "Assuring the Security of the State of Qatar",
      date_signed: "2029-09-29", // the transposed-year bug
    });
    const doc = makeDoc({
      document_number: "2025-19483",
      executive_order_number: "14353",
      title: "Assuring the Security of the State of Qatar",
      signing_date: "2025-09-29",
    });

    const [plan] = planLegacyReconciliation([row], [doc]);

    expect(plan.outcome).toBe("reconciled_date_corrected");
    expect(plan.matchedDocument).toBe(doc);
    expect(plan.reviewReason).toContain("2029-09-29");
    expect(plan.reviewReason).toContain("2025-09-29");
  });

  it("flags rather than reconciles when the title doesn't line up, even if the date is close", () => {
    const row = makeRow({ id: "1", eo_number: "EO 14421", title: "Completely Unrelated Subject Matter", date_signed: "2025-06-01" });
    const doc = makeDoc({
      document_number: "2025-100",
      executive_order_number: "14421",
      title: "Some Order About Something Else Entirely",
      signing_date: "2025-06-01",
    });

    const [plan] = planLegacyReconciliation([row], [doc]);

    expect(plan.outcome).toBe("flagged_low_title_similarity");
    expect(plan.matchedDocument).toBe(doc);
    expect(plan.reviewReason).toContain("doesn't line up confidently");
  });

  it("flags both rows sharing a duplicate eo_number without touching either", () => {
    const rows = [
      makeRow({ id: "1", eo_number: "EO 14232", title: "Amendment A" }),
      makeRow({ id: "2", eo_number: "EO 14232", title: "Amendment B" }),
    ];
    const doc = makeDoc({ document_number: "2025-100", executive_order_number: "14232", title: "Amendment A" });

    const plan = planLegacyReconciliation(rows, [doc]);

    expect(plan.map((p) => p.outcome)).toEqual(["flagged_duplicate_eo_number", "flagged_duplicate_eo_number"]);
    expect(plan.every((p) => p.matchedDocument === null)).toBe(true);
  });

  it("flags when no Federal Register document matches the eo_number at all — the EO 40223/mistyped-number case", () => {
    const row = makeRow({ id: "1", eo_number: "EO 40223" });

    const [plan] = planLegacyReconciliation([row], []);

    expect(plan.outcome).toBe("flagged_no_fr_match");
    expect(plan.matchedDocument).toBeNull();
    expect(plan.reviewReason).toContain("EO 40223");
  });

  it("never matches a legacy row against a correction document instead of the original", () => {
    const row = makeRow({ id: "1", eo_number: "EO 14421", title: "Original Title" });
    const original = makeDoc({
      document_number: "2025-100",
      executive_order_number: "14421",
      title: "Original Title",
      signing_date: "2025-06-01",
    });
    const correction = makeDoc({
      document_number: "2025-200",
      executive_order_number: "14421",
      title: "Original Title (Corrected)",
      correction_of: "https://www.federalregister.gov/api/v1/documents/2025-100",
    });

    const [plan] = planLegacyReconciliation([row], [correction, original]);

    expect(plan.matchedDocument).toBe(original);
  });

  it("flags rather than reconciles when the matched document is already linked to a different row — the EO 14227/14368/14336/14359 case", () => {
    const row = makeRow({ id: "1", eo_number: "EO 14227", title: "Amendment to Duties To Address the Situation at Our Southern Border" });
    const doc = makeDoc({
      document_number: "2025-03729",
      executive_order_number: "14227",
      title: "Amendment to Duties To Address the Situation at Our Southern Border",
    });

    const [plan] = planLegacyReconciliation([row], [doc], new Set(["2025-03729"]));

    expect(plan.outcome).toBe("flagged_document_linked_elsewhere");
    expect(plan.matchedDocument).toBe(doc);
    expect(plan.reviewReason).toContain("already linked to a different row");
  });
});

describe("applyLegacyReconciliationPlan", () => {
  it("clears a stale needs_review/review_reason from before linking when the row reconciles cleanly — the EO 14166 case", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "legacy-eo-166",
          eo_number: "EO 14166",
          title: "old title",
          date_signed: "2025-01-20",
          needs_review: true,
          review_reason: "Federal Register document 2025-02087 matches this row's eo_number (EO 14166) but isn't linked yet.",
        },
      ],
    });
    const doc = makeDoc({
      document_number: "2025-02087",
      executive_order_number: "14166",
      title: "Application of Protecting Americans From Foreign Adversary Controlled Applications Act to TikTok",
      signing_date: "2025-01-20",
    });
    const plan = [
      {
        rowId: "legacy-eo-166",
        eoNumber: "EO 14166",
        legacyTitle: "old title",
        legacyDateSigned: "2025-01-20",
        outcome: "reconciled" as const,
        matchedDocument: doc,
        reviewReason: null,
      },
    ];

    await applyLegacyReconciliationPlan(supabase, plan, async () => "raw text");

    expect(supabase.rows[0].document_number).toBe("2025-02087");
    expect(supabase.rows[0].needs_review).toBe(false);
    expect(supabase.rows[0].review_reason).toBeNull();
  });

  it("writes every deterministic field plus the verify flag for a date-corrected row", async () => {
    const supabase = createFakeSupabase({
      rows: [{ id: "legacy-eo-135", eo_number: "EO 14353", title: "old title", date_signed: "2029-09-29" }],
    });
    const doc = makeDoc({
      document_number: "2025-19483",
      executive_order_number: "14353",
      title: "Assuring the Security of the State of Qatar",
      signing_date: "2025-09-29",
    });
    const plan = [
      {
        rowId: "legacy-eo-135",
        eoNumber: "EO 14353",
        legacyTitle: "old title",
        legacyDateSigned: "2029-09-29",
        outcome: "reconciled_date_corrected" as const,
        matchedDocument: doc,
        reviewReason: "date_signed auto-corrected from 2029-09-29 to 2025-09-29 — verify.",
      },
    ];

    const { tally, errors } = await applyLegacyReconciliationPlan(supabase, plan, async () => "raw text");

    expect(supabase.rows[0].date_signed).toBe("2025-09-29");
    expect(supabase.rows[0].document_number).toBe("2025-19483");
    expect(supabase.rows[0].needs_review).toBe(true);
    expect(supabase.rows[0].review_reason).toContain("2025-09-29");
    expect(tally.reconciled_date_corrected).toBe(1);
    expect(errors).toEqual([]);
  });

  it("only sets needs_review/review_reason for a flagged row, leaving its other fields untouched", async () => {
    const supabase = createFakeSupabase({
      rows: [{ id: "1", eo_number: "EO 40223", title: "untouched title", date_signed: "2025-08-13" }],
    });
    const plan = [
      {
        rowId: "1",
        eoNumber: "EO 40223",
        legacyTitle: "untouched title",
        legacyDateSigned: "2025-08-13",
        outcome: "flagged_no_fr_match" as const,
        matchedDocument: null,
        reviewReason: "No Federal Register document found for EO 40223.",
      },
    ];

    const { tally, errors } = await applyLegacyReconciliationPlan(supabase, plan, async () => {
      throw new Error("should never fetch raw text for a flagged-only row");
    });

    expect(supabase.rows[0].needs_review).toBe(true);
    expect(supabase.rows[0].title).toBe("untouched title");
    expect(supabase.rows[0].date_signed).toBe("2025-08-13");
    expect(tally.flagged_no_fr_match).toBe(1);
    expect(errors).toEqual([]);
  });

  it("records one row's failure as an error and still applies the rest of the batch", async () => {
    const supabase = createFakeSupabase({
      rows: [{ id: "ok-row", eo_number: "EO 1", title: "t", date_signed: "2025-06-01" }],
    });
    const doc = makeDoc({ document_number: "2025-1", executive_order_number: "1", title: "t", signing_date: "2025-06-01" });
    const plan = [
      {
        rowId: "broken-row",
        eoNumber: "EO 2",
        legacyTitle: "t2",
        legacyDateSigned: "2025-06-01",
        outcome: "reconciled" as const,
        matchedDocument: makeDoc({ document_number: "2025-2", executive_order_number: "2", title: "t2", signing_date: "2025-06-01" }),
        reviewReason: null,
      },
      {
        rowId: "ok-row",
        eoNumber: "EO 1",
        legacyTitle: "t",
        legacyDateSigned: "2025-06-01",
        outcome: "reconciled" as const,
        matchedDocument: doc,
        reviewReason: null,
      },
    ];

    let calls = 0;
    const { tally, errors } = await applyLegacyReconciliationPlan(supabase, plan, async () => {
      calls++;
      if (calls === 1) throw new Error("simulated raw-text fetch failure");
      return "raw text";
    });

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("simulated raw-text fetch failure");
    expect(tally.reconciled).toBe(1); // only the second (successful) row counted
    expect(supabase.rows.find((r) => r.id === "ok-row")?.document_number).toBe("2025-1");
  });
});
