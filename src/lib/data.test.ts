import { describe, expect, it } from "vitest";
import {
  flagDuplicateEoNumbers,
  getExecutiveOrderById,
  getExecutiveOrders,
  getExecutiveOrdersByIds,
} from "@/lib/data";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";
import type { ExecutiveOrder } from "@/lib/types";

// Snake_case row fixture matching supabase/migrations/0001_init.sql, for the
// getExecutiveOrders/getExecutiveOrderById/getExecutiveOrdersByIds tests
// below (the pure flagDuplicateEoNumbers tests further down use makeEo
// instead, since that function operates on already-mapped ExecutiveOrders).
function makeRow(overrides: Record<string, unknown> & { id: string }): Record<string, unknown> {
  return {
    eo_number: null,
    action_type: null,
    title: "Untitled",
    federal_register_url: null,
    date_signed: "2025-01-01",
    date_published: null,
    status: "active",
    agencies_impacted: [],
    key_dates: [],
    subject_area: [],
    practice_areas: [],
    industries: [],
    ai_summary: null,
    deliverable: null,
    timeline_notes: null,
    available_analysis: null,
    legal_challenges: [],
    news_mentions: [],
    manually_edited_fields: [],
    document_number: null,
    applied_correction_document_numbers: [],
    citation: null,
    full_text: null,
    source_notes: null,
    needs_review: false,
    review_reason: null,
    federal_register_synced_at: null,
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function makeEo(overrides: Partial<ExecutiveOrder> & { id: string }): ExecutiveOrder {
  return {
    title: "Untitled",
    dateSigned: "2025-01-01",
    status: "active",
    agenciesImpacted: [],
    keyDates: [],
    subjectArea: [],
    practiceAreas: [],
    industries: [],
    legalChallenges: [],
    newsMentions: [],
    manuallyEditedFields: [],
    createdAt: "2025-01-01T00:00:00Z",
    updatedAt: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

describe("flagDuplicateEoNumbers", () => {
  it("leaves orders with unique eoNumbers untouched", () => {
    const orders = [makeEo({ id: "1", eoNumber: "EO 14351" }), makeEo({ id: "2", eoNumber: "EO 14360" })];

    const result = flagDuplicateEoNumbers(orders);

    expect(result.every((eo) => !eo.needsReview)).toBe(true);
  });

  it("flags every order sharing a duplicated eoNumber, not just the second one", () => {
    const orders = [
      makeEo({ id: "1", eoNumber: "EO 14360", title: "First entry" }),
      makeEo({ id: "2", eoNumber: "EO 14232" }),
      makeEo({ id: "3", eoNumber: "EO 14360", title: "Conflicting second entry" }),
    ];

    const result = flagDuplicateEoNumbers(orders);

    expect(result.find((eo) => eo.id === "1")?.needsReview).toBe(true);
    expect(result.find((eo) => eo.id === "3")?.needsReview).toBe(true);
    expect(result.find((eo) => eo.id === "2")?.needsReview).toBeUndefined();
  });

  it("does not flag orders with no eoNumber (Proclamations, Memoranda, etc.)", () => {
    const orders = [makeEo({ id: "1", eoNumber: undefined }), makeEo({ id: "2", eoNumber: undefined })];

    const result = flagDuplicateEoNumbers(orders);

    expect(result.every((eo) => !eo.needsReview)).toBe(true);
  });
});

describe("getExecutiveOrders (list path)", () => {
  it("maps the list columns but excludes full_text and source_notes entirely", async () => {
    const supabase = createFakeSupabase({
      rows: [
        makeRow({
          id: "1",
          title: "Order One",
          ai_summary: "a summary",
          full_text: "the entire legal text",
          source_notes: "internal ingestion notes",
        }),
      ],
    });

    const [eo] = await getExecutiveOrders(supabase);

    expect(eo.title).toBe("Order One");
    expect(eo.aiSummary).toBe("a summary");
    // Not just undefined — the key must not exist, so a caller reading
    // eo.fullText off a list item is a compile error, not a runtime surprise.
    expect("fullText" in eo).toBe(false);
    expect("sourceNotes" in eo).toBe(false);
  });

  it("still applies flagDuplicateEoNumbers to the list result", async () => {
    const supabase = createFakeSupabase({
      rows: [
        makeRow({ id: "1", eo_number: "EO 14360" }),
        makeRow({ id: "2", eo_number: "EO 14360" }),
      ],
    });

    const orders = await getExecutiveOrders(supabase);

    expect(orders.every((eo) => eo.needsReview)).toBe(true);
  });

  it("falls back to local data when the query errors", async () => {
    const supabase = createFakeSupabase({
      rows: [makeRow({ id: "1" })],
      failSelect: { executive_orders: "boom" },
    });

    const orders = await getExecutiveOrders(supabase);

    // Local fallback data is non-empty and unaffected by the forced error.
    expect(orders.length).toBeGreaterThan(0);
  });
});

describe("getExecutiveOrderById (detail path)", () => {
  it("includes full_text for the requested row", async () => {
    const supabase = createFakeSupabase({
      rows: [makeRow({ id: "1", full_text: "the entire legal text" })],
    });

    const eo = await getExecutiveOrderById("1", supabase);

    expect(eo?.fullText).toBe("the entire legal text");
  });

  it("flags a duplicate eoNumber even though it only fetches one row directly", async () => {
    const supabase = createFakeSupabase({
      rows: [
        makeRow({ id: "1", eo_number: "EO 14360" }),
        makeRow({ id: "2", eo_number: "EO 14360" }),
      ],
    });

    const eo = await getExecutiveOrderById("1", supabase);

    expect(eo?.needsReview).toBe(true);
  });

  it("does not flag an eoNumber that appears on only one row", async () => {
    const supabase = createFakeSupabase({
      rows: [makeRow({ id: "1", eo_number: "EO 14360" }), makeRow({ id: "2", eo_number: "EO 14232" })],
    });

    const eo = await getExecutiveOrderById("1", supabase);

    expect(eo?.needsReview).toBeUndefined();
  });

  it("returns null for an id that doesn't exist", async () => {
    const supabase = createFakeSupabase({ rows: [makeRow({ id: "1" })] });

    const eo = await getExecutiveOrderById("missing", supabase);

    expect(eo).toBeNull();
  });
});

describe("getExecutiveOrdersByIds", () => {
  it("returns full-detail rows only for the requested ids", async () => {
    const supabase = createFakeSupabase({
      rows: [
        makeRow({ id: "1", full_text: "text one" }),
        makeRow({ id: "2", full_text: "text two" }),
        makeRow({ id: "3", full_text: "text three" }),
      ],
    });

    const orders = await getExecutiveOrdersByIds(["1", "3"], supabase);

    expect(orders.map((eo) => eo.id).sort()).toEqual(["1", "3"]);
    expect(orders.find((eo) => eo.id === "1")?.fullText).toBe("text one");
  });

  it("returns an empty array without querying for an empty id list", async () => {
    const supabase = createFakeSupabase({ rows: [makeRow({ id: "1" })] });

    const orders = await getExecutiveOrdersByIds([], supabase);

    expect(orders).toEqual([]);
  });
});
