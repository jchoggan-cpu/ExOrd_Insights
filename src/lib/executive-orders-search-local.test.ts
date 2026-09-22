import { describe, expect, it } from "vitest";
import { searchLocalExecutiveOrders } from "@/lib/executive-orders-search-local";
import { parseTrackerQuery } from "@/lib/tracker-query";

/**
 * The no-database fallback used in local development. It must apply the same
 * filters as the SQL in migrations 0008/0009, or a developer without a
 * database sees different results from production and believes them.
 *
 * It reads the bundled legacy dataset through getExecutiveOrders(null), so
 * these assert relationships between queries rather than fixed counts --
 * the bundled data is real and can change.
 */
async function search(params: Record<string, string | string[]>) {
  return searchLocalExecutiveOrders(parseTrackerQuery(params));
}

describe("searchLocalExecutiveOrders — subject filter", () => {
  it("narrows to rows carrying the selected subject", async () => {
    const all = await search({});
    const trade = await search({ subject: "Trade" });

    expect(trade.total).toBeGreaterThan(0);
    expect(trade.total).toBeLessThan(all.total);
    expect(trade.rows.every((row) => row.subjectArea.includes("Trade"))).toBe(true);
  });

  it("ORs several subjects together, widening rather than narrowing", async () => {
    const trade = await search({ subject: "Trade" });
    const both = await search({ subject: ["Trade", "Foreign Affairs"] });

    expect(both.total).toBeGreaterThanOrEqual(trade.total);
    expect(
      both.rows.every(
        (row) => row.subjectArea.includes("Trade") || row.subjectArea.includes("Foreign Affairs"),
      ),
    ).toBe(true);
  });

  it("ANDs the subject against other filters rather than replacing them", async () => {
    const trade = await search({ subject: "Trade" });
    const tradeActive = await search({ subject: "Trade", status: "active" });

    expect(tradeActive.total).toBeLessThanOrEqual(trade.total);
    expect(tradeActive.rows.every((row) => row.status === "active")).toBe(true);
  });

  it("matches nothing for a subject no row carries", async () => {
    const none = await search({ subject: "Not A Real Subject" });
    expect(none.total).toBe(0);
    expect(none.rows).toEqual([]);
  });

  it("does not filter at all when no subject is selected", async () => {
    expect((await search({})).total).toBe((await search({ subject: [] })).total);
  });

  it("carries no snippets, since the bundled data has no full text", async () => {
    // Documented in the module header: ts_headline runs in Postgres over
    // full_text, which this dataset does not have.
    const { rows } = await search({ q: "tariff" });
    expect(rows.every((row) => row.snippet === undefined)).toBe(true);
  });
});
