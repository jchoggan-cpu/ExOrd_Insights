import { describe, expect, it } from "vitest";
import { instrumentKey, normalizeTitle } from "@/lib/normalize-title";

describe("normalizeTitle", () => {
  it("ignores case, punctuation and spacing differences", () => {
    expect(normalizeTitle("Adjusting Imports of Steel Into the United States")).toBe(
      normalizeTitle("adjusting imports of steel  into   the united states"),
    );
    expect(normalizeTitle("Regulatory Relief — Phase 2 (2025)")).toBe("regulatory relief phase 2 2025");
  });

  it("matches the real casing difference the corpus actually contains", () => {
    // Two rows of one merged pair, verbatim from the tracker.
    expect(normalizeTitle("Regulatory Relief for Certain Stationary Sources To Promote American Energy")).toBe(
      normalizeTitle("Regulatory Relief for Certain Stationary Sources to Promote American Energy"),
    );
  });

  it("does not treat titles differing by a word as the same", () => {
    expect(normalizeTitle("Adjusting Imports of Steel")).not.toBe(
      normalizeTitle("Adjusting Imports of Aluminum and Steel"),
    );
  });

  it("survives a title that is only punctuation", () => {
    expect(normalizeTitle("—")).toBe("");
  });
});

describe("instrumentKey", () => {
  it("keeps two same-titled orders signed on different days apart", () => {
    // EO 14310 and EO 14350 share a title and are genuinely different orders.
    const june = instrumentKey("Further Extending the TikTok Enforcement Delay", "2025-06-19");
    const september = instrumentKey("Further Extending the TikTok Enforcement Delay", "2025-09-16");
    expect(june).not.toBe(september);
  });

  it("matches the same instrument recorded with different punctuation", () => {
    expect(instrumentKey("America First Trade Policy", "2025-01-20")).toBe(
      instrumentKey("America  First — Trade Policy", "2025-01-20"),
    );
  });
});
