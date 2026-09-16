import { describe, expect, it } from "vitest";
import type { DuplicatePair, OrderRow } from "@/lib/merge/duplicate-pairs";
import {
  isPresent,
  mergedManuallyEditedFields,
  planMerge,
} from "@/lib/merge/merge-rules";

const FIRM_CURATED = [
  "aiSummary",
  "availableAnalysis",
  "deliverable",
  "legalChallenges",
  "subjectArea",
  "timelineNotes",
];

function pair(legacy: Partial<OrderRow> = {}, federalRegister: Partial<OrderRow> = {}): DuplicatePair {
  return {
    legacy: {
      id: "legacy-1",
      title: "Adjusting Imports of Steel Into the United States",
      date_signed: "2025-02-10",
      document_number: null,
      ai_summary: "This proclamation suspends previous proclamations regarding steel imports.",
      subject_area: ["Trade"],
      practice_areas: ["Global Reach"],
      industries: [],
      agencies_impacted: ["Department of Commerce"],
      timeline_notes: "Effective 3/12/2025.",
      available_analysis: null,
      legal_challenges: [],
      deliverable: "None.",
      citation: null,
      full_text: null,
      federal_register_url: null,
      date_published: null,
      eo_number: null,
      status: "active",
      needs_review: false,
      review_reason: null,
      manually_edited_fields: [...FIRM_CURATED],
      ...legacy,
    },
    federalRegister: {
      id: "fr-1",
      title: "Adjusting Imports of Steel Into the United States",
      date_signed: "2025-02-10",
      document_number: "2025-02833",
      ai_summary: "This proclamation terminates the alternative agreements, quotas and exemptions.",
      subject_area: ["Trade", "Tariffs"],
      practice_areas: ["Global Reach", "Governmental--International Trade"],
      industries: ["Manufacturing"],
      agencies_impacted: [],
      timeline_notes: null,
      available_analysis: null,
      legal_challenges: [],
      deliverable: null,
      citation: "90 FR 9817",
      full_text: "By the authority vested in me...",
      federal_register_url: "https://www.federalregister.gov/documents/2025/02/18/2025-02833",
      date_published: "2025-02-18",
      eo_number: null,
      status: "active",
      needs_review: false,
      review_reason: null,
      manually_edited_fields: [],
      ...federalRegister,
    },
  };
}

describe("isPresent", () => {
  it("treats null, empty string and empty array as absent", () => {
    expect(isPresent(null)).toBe(false);
    expect(isPresent(undefined)).toBe(false);
    expect(isPresent("")).toBe(false);
    expect(isPresent("   ")).toBe(false);
    expect(isPresent([])).toBe(false);
  });

  it("treats a value, a non-empty array and false as present", () => {
    expect(isPresent("text")).toBe(true);
    expect(isPresent(["a"])).toBe(true);
    expect(isPresent(false)).toBe(true);
  });
});

describe("planMerge", () => {
  it("keeps the legacy row and deletes the ingested one", () => {
    const plan = planMerge(pair());
    expect(plan.keepId).toBe("legacy-1");
    expect(plan.deleteId).toBe("fr-1");
  });

  it("copies the provenance fields off the Federal Register row", () => {
    const plan = planMerge(pair());
    expect(plan.updates.document_number).toBe("2025-02833");
    expect(plan.updates.citation).toBe("90 FR 9817");
    expect(plan.updates.full_text).toBe("By the authority vested in me...");
    expect(plan.updates.date_published).toBe("2025-02-18");
    expect(plan.updates.federal_register_url).toContain("federalregister.gov");
  });

  it("keeps the firm's analysis fields", () => {
    const plan = planMerge(pair());
    expect(plan.updates).not.toHaveProperty("timeline_notes");
    expect(plan.updates).not.toHaveProperty("subject_area");
    expect(plan.updates).not.toHaveProperty("agencies_impacted");
  });

  it("takes the AI summary over the firm's, per the 2026-09-16 decision", () => {
    const plan = planMerge(pair());
    expect(plan.updates.ai_summary).toBe(
      "This proclamation terminates the alternative agreements, quotas and exemptions.",
    );
  });

  it("drops aiSummary from manually_edited_fields so the column is not protected as attorney text", () => {
    const plan = planMerge(pair());
    expect(plan.updates.manually_edited_fields).toEqual([
      "availableAnalysis",
      "deliverable",
      "legalChallenges",
      "subjectArea",
      "timelineNotes",
    ]);
  });

  it("takes the newer machine tagging pass for practice areas and industries", () => {
    const plan = planMerge(pair());
    expect(plan.updates.practice_areas).toEqual(["Global Reach", "Governmental--International Trade"]);
    expect(plan.updates.industries).toEqual(["Manufacturing"]);
  });

  it("falls back to the legacy value when the preferred side is empty", () => {
    const plan = planMerge(pair({ industries: ["Healthcare"] }, { industries: [] }));
    expect(plan.updates).not.toHaveProperty("industries");
    const resolution = plan.resolutions.find((r) => r.field === "industries");
    expect(resolution?.source).toBe("legacy");
    expect(resolution?.value).toEqual(["Healthcare"]);
  });

  it("falls back to the Federal Register value when the firm left the field empty", () => {
    const plan = planMerge(pair({ deliverable: null }, { deliverable: "Report due within 90 days." }));
    expect(plan.updates.deliverable).toBe("Report due within 90 days.");
  });

  it("takes the Federal Register disposition when the two disagree on status", () => {
    const plan = planMerge(pair({ status: "active" }, { status: "revoked" }));
    expect(plan.updates.status).toBe("revoked");
  });

  it("records every field where both sides held a differing value", () => {
    const plan = planMerge(pair());
    const conflicted = plan.conflicts.map((c) => c.field).sort();
    expect(conflicted).toEqual(["ai_summary", "practice_areas", "subject_area"]);
  });

  it("keeps the losing value on a conflict so the dry run can show both sides", () => {
    const plan = planMerge(pair());
    const summary = plan.conflicts.find((c) => c.field === "ai_summary");
    expect(summary?.losingValue).toBe(
      "This proclamation suspends previous proclamations regarding steel imports.",
    );
  });

  it("does not report a conflict when both sides hold the same value", () => {
    const identical = "This proclaims April 2025 as National Donate Life Month.";
    const plan = planMerge(pair({ ai_summary: identical }, { ai_summary: identical }));
    expect(plan.conflicts.map((c) => c.field)).not.toContain("ai_summary");
    expect(plan.updates).not.toHaveProperty("ai_summary");
  });

  it("takes the Federal Register's instrument type over a stale spreadsheet placeholder", () => {
    const plan = planMerge(
      pair({ action_type: "Pending Federal Register Publication" }, { action_type: "Executive Order" }),
    );
    expect(plan.updates.action_type).toBe("Executive Order");
  });

  it("takes the Federal Register's instrument type over a misclassification", () => {
    const plan = planMerge(pair({ action_type: "Memorandum" }, { action_type: "Proclamation" }));
    expect(plan.updates.action_type).toBe("Proclamation");
  });

  it("reports a column no rule covers instead of quietly defaulting to the legacy value", () => {
    const plan = planMerge(pair({ some_new_column: "legacy value" }, { some_new_column: "ingested value" }));

    expect(plan.unlistedFields).toContain("some_new_column");
    // The fallback still applies, but it is announced rather than silent.
    expect(plan.updates).not.toHaveProperty("some_new_column");
  });

  it("reports nothing unlisted for the schema as it stands", () => {
    expect(planMerge(pair()).unlistedFields).toEqual([]);
  });

  it("never copies identity, timestamp or generated columns", () => {
    const plan = planMerge(pair());
    for (const column of ["id", "created_at", "updated_at", "search_vector", "title", "date_signed"]) {
      expect(plan.updates).not.toHaveProperty(column);
    }
  });

  it("carries a review flag across from whichever side was flagged", () => {
    const plan = planMerge(pair({}, { needs_review: true, review_reason: "Date auto-corrected — verify." }));
    expect(plan.updates.needs_review).toBe(true);
    expect(plan.updates.review_reason).toBe("Date auto-corrected — verify.");
  });

  it("leaves an already-flagged legacy row flagged", () => {
    const plan = planMerge(pair({ needs_review: true, review_reason: "Check this." }));
    expect(plan.updates).not.toHaveProperty("needs_review");
  });
});

describe("mergedManuallyEditedFields", () => {
  it("removes only aiSummary and leaves the rest untouched", () => {
    const { legacy } = pair();
    expect(mergedManuallyEditedFields(legacy)).toEqual([
      "availableAnalysis",
      "deliverable",
      "legalChallenges",
      "subjectArea",
      "timelineNotes",
    ]);
  });

  it("copes with a row that has no protected fields recorded", () => {
    const { federalRegister } = pair();
    expect(mergedManuallyEditedFields(federalRegister)).toEqual([]);
  });
});
