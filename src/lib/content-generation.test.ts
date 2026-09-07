import { describe, expect, it } from "vitest";
import { computeUnverifiedQuotes } from "@/lib/content-generation";
import type { ExecutiveOrder } from "@/lib/types";

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

describe("computeUnverifiedQuotes", () => {
  it("reports quotesWereChecked: false for orders with no full_text (pre-Phase-2 legacy data) rather than a false-clean result", () => {
    const orders = [makeEo({ id: "1" })];
    const draft = 'The order states "something that sounds like a quote."';
    expect(computeUnverifiedQuotes(draft, orders)).toEqual({ unverifiedQuotes: [], quotesWereChecked: false });
  });

  it("flags a quote not found in the referenced order's full_text", () => {
    const orders = [makeEo({ id: "1", fullText: "Section 1. The policy shall take effect immediately." })];
    const draft = 'The order says "this shall never take effect," which is concerning.';
    expect(computeUnverifiedQuotes(draft, orders)).toEqual({
      unverifiedQuotes: ["this shall never take effect,"],
      quotesWereChecked: true,
    });
  });

  it("checks against the combined full_text of every referenced order", () => {
    const orders = [
      makeEo({ id: "1", fullText: "First order text." }),
      makeEo({ id: "2", fullText: "Second order mentions the reporting deadline." }),
    ];
    const draft = 'The digest notes "the reporting deadline" applies to both.';
    expect(computeUnverifiedQuotes(draft, orders)).toEqual({ unverifiedQuotes: [], quotesWereChecked: true });
  });
});
