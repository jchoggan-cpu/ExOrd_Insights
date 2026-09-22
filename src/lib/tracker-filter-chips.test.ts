import { describe, expect, it } from "vitest";
import {
  activeFilterChips,
  CLEARED_FILTERS,
  hasActiveFilters,
  type FilterChip,
} from "@/lib/tracker-filter-chips";
import { withTrackerChange, type TrackerQuery } from "@/lib/tracker-query";

const BROWSING: TrackerQuery = {
  search: "",
  subjects: [],
  practiceAreas: [],
  industries: [],
  status: "",
  dateFrom: "",
  dateTo: "",
  sort: "date",
  page: 1,
  pageSize: 25,
};

function labels(query: TrackerQuery): string[] {
  return activeFilterChips(query).map((chip) => chip.label);
}

function apply(query: TrackerQuery, chip: FilterChip): TrackerQuery {
  return withTrackerChange(query, chip.clears);
}

describe("hasActiveFilters", () => {
  it("is false when nothing is narrowing the results", () => {
    expect(hasActiveFilters(BROWSING)).toBe(false);
    // Paging and sorting are not filters -- they change the view, not the set.
    expect(hasActiveFilters({ ...BROWSING, page: 4, sort: "relevance" })).toBe(false);
  });

  it("is true for any one filter on its own", () => {
    expect(hasActiveFilters({ ...BROWSING, search: "tariff" })).toBe(true);
    expect(hasActiveFilters({ ...BROWSING, practiceAreas: ["Tax"] })).toBe(true);
    expect(hasActiveFilters({ ...BROWSING, industries: ["Fintech"] })).toBe(true);
    expect(hasActiveFilters({ ...BROWSING, status: "revoked" })).toBe(true);
    expect(hasActiveFilters({ ...BROWSING, dateFrom: "2025-01-20" })).toBe(true);
    expect(hasActiveFilters({ ...BROWSING, dateTo: "2026-01-20" })).toBe(true);
  });
});

describe("activeFilterChips", () => {
  it("has nothing to show while browsing unfiltered", () => {
    expect(activeFilterChips(BROWSING)).toEqual([]);
  });

  it("names the search term", () => {
    expect(labels({ ...BROWSING, search: "tariff OR duty" })).toEqual([
      "Full text: tariff OR duty",
    ]);
  });

  it("shows a subgroup practice area readably", () => {
    // Stored as "Governmental--National Security" for migration 0008's
    // parent-matching; the separator is not for reading.
    expect(labels({ ...BROWSING, practiceAreas: ["Governmental--National Security"] })).toEqual([
      "Practice: Governmental – National Security",
    ]);
  });

  it("gives every selection its own chip", () => {
    expect(
      labels({
        ...BROWSING,
        search: "tariff",
        practiceAreas: ["Tax", "Litigation"],
        industries: ["Fintech"],
        status: "active",
      }),
    ).toEqual([
      "Full text: tariff",
      "Practice: Tax",
      "Practice: Litigation",
      "Industry: Fintech",
      "Status: Active",
    ]);
  });

  it("collapses a full date range into one chip and a half-open one into its own", () => {
    expect(labels({ ...BROWSING, dateFrom: "2025-01-20", dateTo: "2026-01-20" })).toEqual([
      "Signed 2025-01-20 to 2026-01-20",
    ]);
    expect(labels({ ...BROWSING, dateFrom: "2025-01-20" })).toEqual([
      "Signed on or after 2025-01-20",
    ]);
    expect(labels({ ...BROWSING, dateTo: "2026-01-20" })).toEqual([
      "Signed on or before 2026-01-20",
    ]);
  });

  it("removes only its own filter, leaving the rest of a multi-select alone", () => {
    const query: TrackerQuery = {
      ...BROWSING,
      practiceAreas: ["Tax", "Litigation", "Corporate"],
      industries: ["Fintech", "Healthcare"],
    };
    const litigation = activeFilterChips(query).find((c) => c.label === "Practice: Litigation")!;

    const after = apply(query, litigation);
    expect(after.practiceAreas).toEqual(["Tax", "Corporate"]);
    expect(after.industries).toEqual(["Fintech", "Healthcare"]);
  });

  it("clears both bounds when a full range chip is removed", () => {
    const query: TrackerQuery = { ...BROWSING, dateFrom: "2025-01-20", dateTo: "2026-01-20" };
    const after = apply(query, activeFilterChips(query)[0]);
    expect([after.dateFrom, after.dateTo]).toEqual(["", ""]);
  });

  it("returns to an unfiltered query once every chip has been removed", () => {
    let query: TrackerQuery = {
      ...BROWSING,
      search: "tariff",
      practiceAreas: ["Tax"],
      industries: ["Fintech"],
      status: "active",
      dateFrom: "2025-01-20",
      dateTo: "2026-01-20",
    };

    // Re-reading the chips each time, since removing one changes the rest.
    for (let guard = 0; guard < 20 && hasActiveFilters(query); guard += 1) {
      query = apply(query, activeFilterChips(query)[0]);
    }

    expect(hasActiveFilters(query)).toBe(false);
    expect(activeFilterChips(query)).toEqual([]);
  });

  it("clears everything at once, and drops relevance with the search", () => {
    const query: TrackerQuery = {
      ...BROWSING,
      search: "tariff",
      practiceAreas: ["Tax"],
      sort: "relevance",
      page: 6,
    };
    const after = withTrackerChange(query, CLEARED_FILTERS);

    expect(hasActiveFilters(after)).toBe(false);
    expect(after.sort).toBe("date");
    expect(after.page).toBe(1);
  });
});
