import { describe, expect, it } from "vitest";
import { flagDuplicateEoNumbers } from "@/lib/data";
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
