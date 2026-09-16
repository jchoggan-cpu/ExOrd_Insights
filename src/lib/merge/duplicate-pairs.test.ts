import { describe, expect, it } from "vitest";
import {
  findDuplicatePairs,
  normalizeTitle,
  pairKey,
  type OrderRow,
} from "@/lib/merge/duplicate-pairs";

function row(overrides: Partial<OrderRow> & { id: string }): OrderRow {
  return {
    title: "National Donate Life Month, 2025",
    date_signed: "2025-04-03",
    document_number: null,
    ...overrides,
  };
}

describe("normalizeTitle", () => {
  it("ignores case, punctuation and spacing differences", () => {
    expect(normalizeTitle("Adjusting Imports of Steel Into the United States")).toBe(
      normalizeTitle("adjusting imports of steel  into   the united states"),
    );
    expect(normalizeTitle("Regulatory Relief — Phase 2 (2025)")).toBe("regulatory relief phase 2 2025");
  });

  it("does not treat titles differing by a word as the same", () => {
    expect(normalizeTitle("Adjusting Imports of Steel")).not.toBe(
      normalizeTitle("Adjusting Imports of Aluminum and Steel"),
    );
  });
});

describe("pairKey", () => {
  it("includes the signing date, so same-titled orders signed on different days stay apart", () => {
    const june = pairKey("Further Extending the TikTok Enforcement Delay", "2025-06-19");
    const september = pairKey("Further Extending the TikTok Enforcement Delay", "2025-09-16");
    expect(june).not.toBe(september);
  });
});

describe("findDuplicatePairs", () => {
  it("pairs a legacy row with its Federal Register counterpart", () => {
    const legacy = row({ id: "legacy-1" });
    const ingested = row({ id: "fr-1", document_number: "2025-06160" });

    const scan = findDuplicatePairs([legacy, ingested]);

    expect(scan.pairs).toHaveLength(1);
    expect(scan.pairs[0].legacy.id).toBe("legacy-1");
    expect(scan.pairs[0].federalRegister.id).toBe("fr-1");
    expect(scan.irregular).toHaveLength(0);
  });

  it("matches across punctuation and casing differences in the title", () => {
    const scan = findDuplicatePairs([
      row({ id: "legacy-1", title: "Regulatory Relief for Certain Stationary Sources" }),
      row({ id: "fr-1", title: "Regulatory Relief for certain stationary sources", document_number: "2025-1" }),
    ]);

    expect(scan.pairs).toHaveLength(1);
  });

  it("keeps two same-titled orders signed on different dates apart", () => {
    const scan = findDuplicatePairs([
      row({ id: "eo-14310", title: "Further Extending the TikTok Enforcement Delay", date_signed: "2025-06-19", document_number: "2025-11682" }),
      row({ id: "eo-14350", title: "Further Extending the TikTok Enforcement Delay", date_signed: "2025-09-16", document_number: "2025-18482" }),
    ]);

    expect(scan.pairs).toHaveLength(0);
    expect(scan.irregular).toHaveLength(0);
  });

  it("reports a group of three rather than guessing which two to merge", () => {
    const scan = findDuplicatePairs([
      row({ id: "legacy-1" }),
      row({ id: "legacy-2" }),
      row({ id: "fr-1", document_number: "2025-06160" }),
    ]);

    expect(scan.pairs).toHaveLength(0);
    expect(scan.irregular).toHaveLength(1);
    expect(scan.irregular[0].rows).toHaveLength(3);
    expect(scan.irregular[0].reason).toContain("3 rows");
  });

  it("reports two legacy rows with no ingested counterpart rather than pairing them", () => {
    const scan = findDuplicatePairs([row({ id: "legacy-1" }), row({ id: "legacy-2" })]);

    expect(scan.pairs).toHaveLength(0);
    expect(scan.irregular).toHaveLength(1);
  });

  it("reports two ingested rows rather than pairing them", () => {
    const scan = findDuplicatePairs([
      row({ id: "fr-1", document_number: "2025-1" }),
      row({ id: "fr-2", document_number: "2025-2" }),
    ]);

    expect(scan.pairs).toHaveLength(0);
    expect(scan.irregular).toHaveLength(1);
  });

  it("counts undated rows instead of matching them on title alone", () => {
    const scan = findDuplicatePairs([
      row({ id: "a", date_signed: null }),
      row({ id: "b", date_signed: null, document_number: "2025-1" }),
    ]);

    expect(scan.pairs).toHaveLength(0);
    expect(scan.undatedCount).toBe(2);
  });

  it("leaves a row with no duplicate alone", () => {
    const scan = findDuplicatePairs([row({ id: "only", document_number: "2025-1" })]);

    expect(scan.pairs).toHaveLength(0);
    expect(scan.irregular).toHaveLength(0);
  });
});
