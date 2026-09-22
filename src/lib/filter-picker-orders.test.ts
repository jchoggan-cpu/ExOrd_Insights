import { describe, expect, it } from "vitest";
import {
  filterPickerOrders,
  hasPickerFilters,
  NO_PICKER_FILTERS,
  type PickerFilters,
} from "@/lib/filter-picker-orders";
import type { ExecutiveOrderListItem } from "@/lib/types";

function eo(overrides: Partial<ExecutiveOrderListItem> = {}): ExecutiveOrderListItem {
  return {
    id: "1",
    eoNumber: "EO 14259",
    actionType: "Executive Order",
    title: "Amendment to Reciprocal Tariffs",
    dateSigned: "2025-04-08",
    status: "active",
    subjectArea: ["Trade"],
    practiceAreas: ["Governmental--International Trade"],
    industries: ["Retail"],
    legalChallenges: [],
    needsReview: false,
    aiSummary: "Raises duties on low-value imports.",
    ...overrides,
  } as ExecutiveOrderListItem;
}

const CORPUS = [
  eo(),
  eo({ id: "2", eoNumber: "EO 14300", title: "Protecting Water Quality", subjectArea: ["Environment/Energy"], practiceAreas: ["Environmental"], industries: ["Utilities"], aiSummary: "Water oversight." }),
  eo({ id: "3", eoNumber: undefined, actionType: "Proclamation", title: "National Day of Observance", subjectArea: ["Establishing Dates of Importance"], practiceAreas: [], industries: [], status: "revoked", aiSummary: "Ceremonial." }),
];

function filter(overrides: Partial<PickerFilters>, keep = new Set<string>()) {
  return filterPickerOrders(CORPUS, { ...NO_PICKER_FILTERS, ...overrides }, keep).map((o) => o.id);
}

describe("filterPickerOrders", () => {
  it("returns everything when nothing is filtered", () => {
    expect(filter({})).toEqual(["1", "2", "3"]);
  });

  it("matches title, number, action type and summary", () => {
    expect(filter({ search: "tariffs" })).toEqual(["1"]);
    expect(filter({ search: "14300" })).toEqual(["2"]);
    expect(filter({ search: "proclamation" })).toEqual(["3"]);
    expect(filter({ search: "water oversight" })).toEqual(["2"]);
  });

  it("ignores case and surrounding whitespace", () => {
    expect(filter({ search: "  TARIFFS " })).toEqual(["1"]);
  });

  it("filters by subject, industry and status", () => {
    expect(filter({ subjects: ["Trade"] })).toEqual(["1"]);
    expect(filter({ industries: ["Utilities"] })).toEqual(["2"]);
    expect(filter({ status: "revoked" })).toEqual(["3"]);
  });

  it("matches a practice-area parent against its subgroups, as the tracker does", () => {
    // "Governmental--International Trade" must be found by "Governmental".
    expect(filter({ practiceAreas: ["Governmental"] })).toEqual(["1"]);
  });

  it("ANDs the filters together", () => {
    expect(filter({ subjects: ["Trade"], status: "revoked" })).toEqual([]);
  });

  it("keeps a selected order visible even when it does not match", () => {
    // Otherwise narrowing hides what you picked, and the "3 selected" count
    // disagrees with everything on screen.
    expect(filter({ search: "water" }, new Set(["1"]))).toEqual(["1", "2"]);
  });

  it("returns nothing when nothing matches and nothing is selected", () => {
    expect(filter({ search: "zzzz" })).toEqual([]);
  });
});

describe("hasPickerFilters", () => {
  it("is false for no filters and for whitespace alone", () => {
    expect(hasPickerFilters(NO_PICKER_FILTERS)).toBe(false);
    expect(hasPickerFilters({ ...NO_PICKER_FILTERS, search: "   " })).toBe(false);
  });

  it("is true for any one filter", () => {
    expect(hasPickerFilters({ ...NO_PICKER_FILTERS, search: "x" })).toBe(true);
    expect(hasPickerFilters({ ...NO_PICKER_FILTERS, subjects: ["Trade"] })).toBe(true);
    expect(hasPickerFilters({ ...NO_PICKER_FILTERS, status: "active" })).toBe(true);
  });
});
