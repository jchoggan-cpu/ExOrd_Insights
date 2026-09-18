import { describe, expect, it } from "vitest";
import {
  flagDuplicateEoNumbers,
  getAgencyActions,
  getExecutiveOrderById,
  getExecutiveOrders,
  getExecutiveOrdersByIds,
  getRecentIngestionRuns,
  getRescindedPriorOrders,
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

  it("throws when the query errors, rather than serving the January spreadsheet", async () => {
    // The whole point: the "showing spreadsheet data" banner is gated on
    // whether Supabase is CONFIGURED, so a configured project whose query
    // failed used to render 340 nine-month-old rows as though they were
    // live, with nothing on the page to say otherwise.
    const supabase = createFakeSupabase({
      rows: [makeRow({ id: "1" })],
      failSelect: { executive_orders: "boom" },
    });

    await expect(getExecutiveOrders(supabase)).rejects.toThrow(/Failed to fetch executive orders: boom/);
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

describe("a failed query never degrades into stale or empty data", () => {
  // Six reads used to swallow a query error. Each degraded differently and
  // every one of them lied: the list served January's spreadsheet, the
  // detail read reported "not found" (legacy ids are "legacy-eo-N" and live
  // ids are uuids, so find() could never match), and the run history read
  // as "nothing has ever run". searchExecutiveOrders already threw; these
  // now match it.

  it("still resolves to an empty list for a healthy but empty table", async () => {
    // The regression this change could plausibly have introduced. The guard
    // is `if (error || !data)`, and it must not fire on a table that simply
    // has no rows: supabase-js returns data: [] there, not null. An empty
    // tracker and an unreadable one mean opposite things.
    const supabase = createFakeSupabase({ rows: [] });

    await expect(getExecutiveOrders(supabase)).resolves.toEqual([]);
    await expect(getExecutiveOrdersByIds(["1"], supabase)).resolves.toEqual([]);
  });

  it("getExecutiveOrderById throws rather than reporting a missing order", async () => {
    const supabase = createFakeSupabase({
      rows: [makeRow({ id: "1" })],
      failSelect: { executive_orders: "boom" },
    });

    await expect(getExecutiveOrderById("1", supabase)).rejects.toThrow(/Failed to fetch executive order 1: boom/);
  });

  it("getExecutiveOrderById still returns null for a row that genuinely is not there", async () => {
    // A real 404 must stay a 404 — only a FAILED query becomes a throw.
    const supabase = createFakeSupabase({ rows: [makeRow({ id: "1" })] });

    await expect(getExecutiveOrderById("nope", supabase)).resolves.toBeNull();
  });

  it("getExecutiveOrdersByIds throws rather than returning no orders", async () => {
    // This one feeds content generation, which quote-checks drafts against
    // fullText. Silently returning nothing risks a client alert grounded in
    // the wrong text.
    const supabase = createFakeSupabase({
      rows: [makeRow({ id: "1" })],
      failSelect: { executive_orders: "boom" },
    });

    await expect(getExecutiveOrdersByIds(["1"], supabase)).rejects.toThrow(/Failed to fetch executive orders by id/);
  });

  it("getRescindedPriorOrders throws rather than serving the spreadsheet", async () => {
    const supabase = createFakeSupabase({ failSelect: { rescinded_prior_orders: "boom" } });
    await expect(getRescindedPriorOrders(supabase)).rejects.toThrow(/Failed to fetch rescinded prior orders/);
  });

  it("getAgencyActions throws rather than serving the spreadsheet", async () => {
    const supabase = createFakeSupabase({ failSelect: { agency_actions: "boom" } });
    await expect(getAgencyActions(supabase)).rejects.toThrow(/Failed to fetch agency actions/);
  });

  it("getRecentIngestionRuns throws rather than reading as an empty run history", async () => {
    const supabase = createFakeSupabase({ failSelect: { ingestion_runs: "boom" } });
    await expect(getRecentIngestionRuns(20, supabase)).rejects.toThrow(/Failed to fetch ingestion runs/);
  });
});
