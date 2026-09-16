import { describe, expect, it } from "vitest";
import {
  buildTrackerQueryString,
  offsetFor,
  parseTrackerQuery,
  totalPagesFor,
  withTrackerChange,
  type TrackerQuery,
} from "@/lib/tracker-query";

const DEFAULTS: TrackerQuery = {
  search: "",
  practiceAreas: [],
  industries: [],
  status: "",
  dateFrom: "",
  dateTo: "",
  sort: "date",
  page: 1,
  pageSize: 25,
};

/**
 * Turns a query string back into the shape Next hands to a page. Repeated
 * parameters must stay arrays: Object.fromEntries would keep only the last
 * value, which is exactly the bug a multi-select filter would hit.
 */
function asSearchParams(queryString: string): Record<string, string | string[]> {
  const params = new URLSearchParams(queryString);
  const entries: Record<string, string | string[]> = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    entries[key] = values.length > 1 ? values : values[0];
  }
  return entries;
}

describe("parseTrackerQuery", () => {
  it("returns defaults for an empty URL", () => {
    expect(parseTrackerQuery({})).toEqual(DEFAULTS);
  });

  it("reads every parameter", () => {
    expect(
      parseTrackerQuery({
        q: "critical minerals",
        practice: "Tax",
        industry: "Energy and Infrastructure",
        status: "revoked",
        from: "2025-02-01",
        to: "2026-02-01",
        sort: "relevance",
        page: "3",
        size: "50",
      }),
    ).toEqual({
      search: "critical minerals",
      practiceAreas: ["Tax"],
      industries: ["Energy and Infrastructure"],
      status: "revoked",
      dateFrom: "2025-02-01",
      dateTo: "2026-02-01",
      sort: "relevance",
      page: 3,
      pageSize: 50,
    });
  });

  it("takes the first value when a parameter is repeated", () => {
    expect(parseTrackerQuery({ q: ["first", "second"] }).search).toBe("first");
  });

  it("trims surrounding whitespace from the search term", () => {
    expect(parseTrackerQuery({ q: "  tariff  " }).search).toBe("tariff");
  });

  describe("rejects hand-edited nonsense rather than trusting the URL", () => {
    it("falls back to page 1 for zero, negative and non-numeric pages", () => {
      for (const page of ["0", "-3", "abc", "1.5", ""]) {
        expect(parseTrackerQuery({ page }).page).toBe(1);
      }
    });

    it("falls back to the default page size for an unsupported one", () => {
      expect(parseTrackerQuery({ size: "9999" }).pageSize).toBe(25);
      expect(parseTrackerQuery({ size: "banana" }).pageSize).toBe(25);
    });

    it("accepts 'all' as a page size", () => {
      expect(parseTrackerQuery({ size: "all" }).pageSize).toBe("all");
    });

    it("drops a status that isn't one of the three real ones", () => {
      // Left in place it would silently match nothing and look like a bug.
      expect(parseTrackerQuery({ status: "pending" }).status).toBe("");
      expect(parseTrackerQuery({ status: "revoked" }).status).toBe("revoked");
    });

    it("falls back to date sort for an unknown sort mode", () => {
      expect(parseTrackerQuery({ sort: "sideways" }).sort).toBe("date");
    });
  });
});

describe("buildTrackerQueryString", () => {
  it("produces an empty string when everything is at its default", () => {
    expect(buildTrackerQueryString(DEFAULTS)).toBe("");
  });

  it("omits defaults but keeps what differs", () => {
    const qs = buildTrackerQueryString({ ...DEFAULTS, search: "tariff", page: 2 });
    expect(qs).toBe("q=tariff&page=2");
  });

  it("round-trips through parse unchanged", () => {
    const original: TrackerQuery = {
      search: "tariff OR duty",
      practiceAreas: ["Tax", "Governmental--National Security"],
      industries: ["Fintech", "Healthcare"],
      status: "active",
      dateFrom: "2025-01-20",
      dateTo: "2026-01-20",
      sort: "relevance",
      page: 4,
      pageSize: 100,
    };

    expect(parseTrackerQuery(asSearchParams(buildTrackerQueryString(original)))).toEqual(original);
  });
});

describe("withTrackerChange", () => {
  it("resets to page 1 when the result set changes", () => {
    const onPage12 = { ...DEFAULTS, page: 12 };
    // Narrowing while deep in the results would otherwise land on an empty
    // page, which reads as "no matches" rather than "you moved".
    expect(withTrackerChange(onPage12, { search: "tariff" }).page).toBe(1);
    expect(withTrackerChange(onPage12, { practiceAreas: ["Tax"] }).page).toBe(1);
    expect(withTrackerChange(onPage12, { dateFrom: "2025-06-01" }).page).toBe(1);
    expect(withTrackerChange(onPage12, { pageSize: 100 }).page).toBe(1);
    expect(withTrackerChange(onPage12, { sort: "relevance" }).page).toBe(1);
  });

  it("keeps the page when only the page changes", () => {
    expect(withTrackerChange(DEFAULTS, { page: 5 }).page).toBe(5);
  });

  it("honors an explicit page alongside another change", () => {
    expect(withTrackerChange(DEFAULTS, { search: "tariff", page: 3 }).page).toBe(3);
  });
});

describe("offsetFor and totalPagesFor", () => {
  it("computes the offset from a 1-based page", () => {
    expect(offsetFor({ ...DEFAULTS, page: 1 })).toBe(0);
    expect(offsetFor({ ...DEFAULTS, page: 3, pageSize: 25 })).toBe(50);
    expect(offsetFor({ ...DEFAULTS, page: 2, pageSize: 100 })).toBe(100);
  });

  it("never offsets when showing all rows — there is only one page", () => {
    expect(offsetFor({ ...DEFAULTS, page: 7, pageSize: "all" })).toBe(0);
    expect(totalPagesFor(614, "all")).toBe(1);
  });

  it("rounds a partial last page up", () => {
    expect(totalPagesFor(614, 25)).toBe(25);
    expect(totalPagesFor(100, 25)).toBe(4);
    expect(totalPagesFor(101, 25)).toBe(5);
  });

  it("reports one page when nothing matches, so the UI never says 'page 1 of 0'", () => {
    expect(totalPagesFor(0, 25)).toBe(1);
  });
});

describe("parseTrackerQuery — multi-select and dates", () => {
  it("reads a repeated parameter as several selections", () => {
    const query = parseTrackerQuery({ practice: ["Tax", "Litigation"] });
    expect(query.practiceAreas).toEqual(["Tax", "Litigation"]);
  });

  it("reads a single selection as a one-element list", () => {
    expect(parseTrackerQuery({ practice: "Tax" }).practiceAreas).toEqual(["Tax"]);
  });

  it("accepts a comma-separated list, for a hand-written URL", () => {
    expect(parseTrackerQuery({ industry: "Fintech,Healthcare" }).industries).toEqual(["Fintech", "Healthcare"]);
  });

  it("drops duplicates and blanks", () => {
    expect(parseTrackerQuery({ practice: ["Tax", "Tax", "", "  "] }).practiceAreas).toEqual(["Tax"]);
  });

  it("keeps a subgroup tag intact, separator and all", () => {
    const query = parseTrackerQuery({ practice: "Governmental--National Security" });
    expect(query.practiceAreas).toEqual(["Governmental--National Security"]);
  });

  it("accepts ISO dates", () => {
    const query = parseTrackerQuery({ from: "2025-01-20", to: "2026-09-13" });
    expect(query.dateFrom).toBe("2025-01-20");
    expect(query.dateTo).toBe("2026-09-13");
  });

  it("rejects a date that is not an ISO date, rather than passing it to SQL", () => {
    // These arrive from a URL a person can type.
    expect(parseTrackerQuery({ from: "last tuesday" }).dateFrom).toBe("");
    expect(parseTrackerQuery({ from: "2025-13-45" }).dateFrom).toBe("");
    expect(parseTrackerQuery({ to: "2025/01/20" }).dateTo).toBe("");
  });

  it("emits one parameter per selection", () => {
    const qs = buildTrackerQueryString({ ...DEFAULTS, practiceAreas: ["Tax", "Litigation"] });
    expect(qs).toBe("practice=Tax&practice=Litigation");
  });

  it("omits date parameters when unset", () => {
    expect(buildTrackerQueryString({ ...DEFAULTS, search: "x" })).toBe("q=x");
  });
});
