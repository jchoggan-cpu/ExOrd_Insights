import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";
import {
  applyDuplicateFlag,
  countRowsSharingEoNumbers,
  flagDuplicatesFromCounts,
} from "@/lib/duplicate-eo-numbers";
import type { ExecutiveOrder } from "@/lib/types";

function listRow(id: string, eoNumber?: string) {
  return { id, eoNumber, needsReview: false, needsReviewReason: undefined };
}

describe("countRowsSharingEoNumbers", () => {
  it("counts how many rows in the whole table carry each number", async () => {
    const supabase = createFakeSupabase({
      rows: [
        { id: "1", eo_number: "EO 14166" },
        { id: "2", eo_number: "EO 14166" },
        { id: "3", eo_number: "EO 14217" },
      ],
    });

    const counts = await countRowsSharingEoNumbers(supabase, ["EO 14166", "EO 14217"]);
    expect(counts.get("EO 14166")).toBe(2);
    expect(counts.get("EO 14217")).toBe(1);
  });

  it("asks nothing of the database when there are no numbers to check", async () => {
    const supabase = createFakeSupabase({ failSelect: { executive_orders: "should not be queried" } });
    await expect(countRowsSharingEoNumbers(supabase, [])).resolves.toEqual(new Map());
  });

  it("fails open with an empty map when the query errors", async () => {
    const supabase = createFakeSupabase({ failSelect: { executive_orders: "connection reset" } });
    // Nothing flagged beats the tracker refusing to render — but it is logged.
    await expect(countRowsSharingEoNumbers(supabase, ["EO 14166"])).resolves.toEqual(new Map());
  });
});

describe("flagDuplicatesFromCounts", () => {
  it("flags an order whose duplicate is NOT on the same page", () => {
    // The pagination hazard: only "EO 14166" is on this page, but the table
    // holds two of them. A page-local check would miss it entirely.
    const page = [listRow("1", "EO 14166")];
    const counts = new Map([["EO 14166", 2]]);

    const [flagged] = flagDuplicatesFromCounts(page, counts);
    expect(flagged.needsReview).toBe(true);
    expect(flagged.needsReviewReason).toContain("more than one record");
  });

  it("leaves a unique number alone", () => {
    const [row] = flagDuplicatesFromCounts([listRow("1", "EO 14217")], new Map([["EO 14217", 1]]));
    expect(row.needsReview).toBe(false);
  });

  it("ignores rows with no EO number, such as memoranda", () => {
    const [row] = flagDuplicatesFromCounts([listRow("1")], new Map([["EO 14166", 5]]));
    expect(row.needsReview).toBe(false);
  });
});

describe("applyDuplicateFlag", () => {
  const order = { id: "1", eoNumber: "EO 14166", needsReview: false } as unknown as ExecutiveOrder;

  it("flags a detail row whose number appears on another record", async () => {
    const supabase = createFakeSupabase({
      rows: [{ id: "1", eo_number: "EO 14166" }, { id: "2", eo_number: "EO 14166" }],
    });

    const result = await applyDuplicateFlag(supabase, order);
    expect(result.needsReview).toBe(true);
  });

  it("leaves a unique detail row unflagged", async () => {
    const supabase = createFakeSupabase({ rows: [{ id: "1", eo_number: "EO 14166" }] });
    expect((await applyDuplicateFlag(supabase, order)).needsReview).toBe(false);
  });

  it("returns the order unflagged, not an error, when the check fails", async () => {
    const supabase = createFakeSupabase({ failSelect: { executive_orders: "boom" } });
    await expect(applyDuplicateFlag(supabase, order)).resolves.toMatchObject({ needsReview: false });
  });
});
