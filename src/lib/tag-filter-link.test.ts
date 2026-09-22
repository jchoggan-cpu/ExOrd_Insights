import { describe, expect, it } from "vitest";
import { tagFilterHref, undoHref, UNDO_PARAM } from "@/lib/tag-filter-link";
import type { TrackerQuery } from "@/lib/tracker-query";

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

describe("tagFilterHref", () => {
  it("filters to just that tag when nothing was filtered", () => {
    expect(tagFilterHref(BROWSING, "subject", "Trade")).toBe("/?subject=Trade");
    expect(tagFilterHref(BROWSING, "practice", "Tax")).toBe("/?practice=Tax");
    expect(tagFilterHref(BROWSING, "industry", "Fintech")).toBe("/?industry=Fintech");
  });

  it("carries no undo when there was nothing to undo", () => {
    expect(tagFilterHref(BROWSING, "subject", "Trade")).not.toContain(UNDO_PARAM);
  });

  it("replaces existing filters rather than adding to them", () => {
    const filtered: TrackerQuery = {
      ...BROWSING,
      search: "tariff",
      subjects: ["Tech"],
      industries: ["Fintech"],
      status: "active",
    };
    const href = tagFilterHref(filtered, "subject", "Trade");

    expect(href.startsWith("/?subject=Trade&")).toBe(true);
    // The point of replacing: none of the old filters survive into the link.
    expect(href.split(`${UNDO_PARAM}=`)[0]).not.toContain("industry=");
    expect(href.split(`${UNDO_PARAM}=`)[0]).not.toContain("q=");
  });

  it("carries the previous filters so they can be restored", () => {
    const filtered: TrackerQuery = { ...BROWSING, search: "tariff", industries: ["Fintech"] };
    const href = tagFilterHref(filtered, "subject", "Trade");
    const undo = decodeURIComponent(href.split(`${UNDO_PARAM}=`)[1]);

    expect(undo).toContain("q=tariff");
    expect(undo).toContain("industry=Fintech");
  });

  it("round-trips: undoing a tag click restores exactly what was there", () => {
    const filtered: TrackerQuery = {
      ...BROWSING,
      search: "tariff",
      industries: ["Fintech", "Healthcare"],
      status: "active",
      sort: "relevance",
    };
    const href = tagFilterHref(filtered, "subject", "Trade");
    const undo = decodeURIComponent(href.split(`${UNDO_PARAM}=`)[1]);

    expect(undoHref(undo)).toBe(`/?${new URLSearchParams(undo).toString()}`);
  });

  it("escapes a tag containing a slash", () => {
    // Real subjects include "Environment/Energy".
    const href = tagFilterHref(BROWSING, "subject", "Environment/Energy");
    expect(href).toBe("/?subject=Environment%2FEnergy");
  });
});

describe("undoHref", () => {
  it("returns the bare tracker when there is nothing to restore", () => {
    expect(undoHref("")).toBe("/");
  });

  it("refuses to send the reader off the site", () => {
    // The parameter is editable by hand; it must be rebuilt, never trusted.
    expect(undoHref("https://elsewhere.example/steal")).toBe("/");
    expect(undoHref("//elsewhere.example")).toBe("/");
  });

  it("drops parameters the tracker does not recognize", () => {
    expect(undoHref("q=tariff&nonsense=1")).toBe("/?q=tariff");
  });
});
