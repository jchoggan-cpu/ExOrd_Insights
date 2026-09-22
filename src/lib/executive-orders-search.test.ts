import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";
import { searchExecutiveOrders } from "@/lib/executive-orders-search";
import { parseTrackerQuery } from "@/lib/tracker-query";

/** One row in the shape search_executive_orders returns. */
function searchRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "row-1",
    eo_number: "EO 14166",
    action_type: "Executive Order",
    title: "Some Order",
    date_signed: "2026-01-20",
    status: "active",
    subject_area: ["Trade"],
    practice_areas: [],
    industries: [],
    legal_challenges: [],
    needs_review: false,
    review_reason: null,
    ai_summary: "This EO does a thing.",
    snippet: null,
    total_count: 1,
    ...overrides,
  };
}

describe("searchExecutiveOrders", () => {
  it("sends null rather than an empty array when no subject is selected", () => {
    // The function reads null and empty the same way, but null is the
    // clearer signal of "not filtering on this" -- and an empty array would
    // read as "filter to nothing" to anyone scanning the call.
    const supabase = createFakeSupabase({ rpc: { search_executive_orders: [searchRow()] } });
    return searchExecutiveOrders(parseTrackerQuery({}), supabase).then(() => {
      expect(supabase.rpcCalls[0].args).toMatchObject({ p_subjects: null });
    });
  });

  it("carries a snippet through to the row when the database returns one", async () => {
    const supabase = createFakeSupabase({
      rpc: {
        search_executive_orders: [
          searchRow({ snippet: "the reciprocal [[hl]]tariff[[/hl]] rates" }),
        ],
      },
    });

    const { rows } = await searchExecutiveOrders(parseTrackerQuery({ q: "tariff" }), supabase);
    expect(rows[0].snippet).toBe("the reciprocal [[hl]]tariff[[/hl]] rates");
  });

  it("leaves snippet undefined when the database returns none", async () => {
    // Null on every row while browsing, and on a search whose match came
    // from the title, summary or tags rather than the body.
    const supabase = createFakeSupabase({ rpc: { search_executive_orders: [searchRow()] } });
    const { rows } = await searchExecutiveOrders(parseTrackerQuery({}), supabase);
    expect(rows[0].snippet).toBeUndefined();
  });

  it("passes the query through to the database function", async () => {
    const supabase = createFakeSupabase({ rpc: { search_executive_orders: [searchRow()] } });
    const query = parseTrackerQuery({
      q: "tariff",
      subject: ["Trade", "Foreign Affairs"],
      practice: ["Tax", "Governmental--National Security"],
      industry: "Fintech",
      status: "revoked",
      from: "2025-01-20",
      to: "2026-01-20",
      sort: "relevance",
      page: "3",
      size: "50",
    });

    await searchExecutiveOrders(query, supabase);

    expect(supabase.rpcCalls[0]).toEqual({
      name: "search_executive_orders",
      args: {
        p_search: "tariff",
        p_subjects: ["Trade", "Foreign Affairs"],
        p_practice_areas: ["Tax", "Governmental--National Security"],
        p_industries: ["Fintech"],
        p_status: "revoked",
        p_date_from: "2025-01-20",
        p_date_to: "2026-01-20",
        p_sort: "relevance",
        p_limit: 50,
        p_offset: 100, // page 3 at 50 per page
      },
    });
  });

  it("sends nulls rather than empty strings for absent filters", async () => {
    const supabase = createFakeSupabase({ rpc: { search_executive_orders: [] } });
    await searchExecutiveOrders(parseTrackerQuery({}), supabase);

    expect(supabase.rpcCalls[0].args).toMatchObject({
      p_search: null,
      // Null rather than [] — an empty array could be read as "match nothing"
      // by a future reader of the SQL; null says "not filtering on this".
      p_practice_areas: null,
      p_industries: null,
      p_status: null,
      p_date_from: null,
      p_date_to: null,
      p_offset: 0,
    });
  });

  it("sends a null limit for 'all', which the function reads as no limit", async () => {
    const supabase = createFakeSupabase({ rpc: { search_executive_orders: [] } });
    await searchExecutiveOrders(parseTrackerQuery({ size: "all", page: "4" }), supabase);

    expect(supabase.rpcCalls[0].args).toMatchObject({ p_limit: null, p_offset: 0 });
  });

  it("maps database columns onto the shape the table renders", async () => {
    const supabase = createFakeSupabase({ rpc: { search_executive_orders: [searchRow()] } });
    const { rows } = await searchExecutiveOrders(parseTrackerQuery({}), supabase);

    expect(rows[0]).toMatchObject({
      id: "row-1",
      eoNumber: "EO 14166",
      title: "Some Order",
      subjectArea: ["Trade"],
      aiSummary: "This EO does a thing.",
    });
  });

  it("reads the total off the repeated window count, and derives the page count", async () => {
    const supabase = createFakeSupabase({
      rpc: { search_executive_orders: [searchRow({ total_count: 614 })] },
    });

    const result = await searchExecutiveOrders(parseTrackerQuery({ page: "2" }), supabase);
    expect(result.total).toBe(614);
    expect(result.totalPages).toBe(25);
    expect(result.page).toBe(2);
  });

  it("reports zero matches without inventing a total", async () => {
    const supabase = createFakeSupabase({ rpc: { search_executive_orders: [] } });
    const result = await searchExecutiveOrders(parseTrackerQuery({ q: "zzzz" }), supabase);

    expect(result).toMatchObject({ total: 0, rows: [], totalPages: 1 });
  });

  it("flags a duplicate EO number whose twin is on a DIFFERENT page", async () => {
    // The row on this page looks unique; the table holds two of them. Counting
    // against the table rather than the page is what catches it.
    const supabase = createFakeSupabase({
      rpc: { search_executive_orders: [searchRow({ total_count: 614 })] },
      rows: [
        { id: "row-1", eo_number: "EO 14166" },
        { id: "row-999", eo_number: "EO 14166" },
      ],
    });

    const { rows } = await searchExecutiveOrders(parseTrackerQuery({}), supabase);
    expect(rows[0].needsReview).toBe(true);
    expect(rows[0].needsReviewReason).toContain("more than one record");
  });

  it("throws rather than rendering an empty tracker when the search fails", async () => {
    // An empty page that should have had 614 rows is indistinguishable from
    // "nothing matched" unless the failure is surfaced.
    const supabase = createFakeSupabase({
      failRpc: { search_executive_orders: "function does not exist" },
    });

    await expect(searchExecutiveOrders(parseTrackerQuery({}), supabase)).rejects.toThrow(
      /function does not exist/,
    );
  });
});
