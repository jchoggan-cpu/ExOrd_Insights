import { describe, expect, it } from "vitest";
import { draftsForSelection, draftsMatchingType } from "@/lib/drafts-for-selection";
import type { SharedDraft } from "@/lib/content-drafts";

function draft(overrides: Partial<SharedDraft> = {}): SharedDraft {
  return {
    id: "d1",
    eoIds: ["eo-1"],
    contentType: "client_alert",
    title: "A draft",
    draftText: "text",
    createdAt: "2026-09-24T10:00:00Z",
    ...overrides,
  };
}

const CORPUS: SharedDraft[] = [
  draft({ id: "d1", eoIds: ["eo-1"], contentType: "client_alert" }),
  draft({ id: "d2", eoIds: ["eo-1"], contentType: "blog_post" }),
  draft({ id: "d3", eoIds: ["eo-2"], contentType: "client_alert" }),
  // A multi-order digest: relevant to anyone writing about any one of them.
  draft({ id: "d4", eoIds: ["eo-2", "eo-3", "eo-4"], contentType: "talking_points" }),
];

describe("draftsForSelection", () => {
  it("finds drafts about a selected order", () => {
    expect(draftsForSelection(CORPUS, ["eo-1"]).map((d) => d.id)).toEqual(["d1", "d2"]);
  });

  it("finds a multi-order digest by any one of its orders", () => {
    // Someone about to write about eo-3 should be told the digest exists,
    // even though the digest is mostly about other orders.
    expect(draftsForSelection(CORPUS, ["eo-3"]).map((d) => d.id)).toEqual(["d4"]);
  });

  it("returns nothing when nothing is selected", () => {
    // The drafter renders before anything is ticked; it must not warn then.
    expect(draftsForSelection(CORPUS, [])).toEqual([]);
  });

  it("returns nothing for an order nobody has written about", () => {
    expect(draftsForSelection(CORPUS, ["eo-unwritten"])).toEqual([]);
  });

  it("does not repeat a draft that covers two selected orders", () => {
    expect(draftsForSelection(CORPUS, ["eo-2", "eo-3"]).map((d) => d.id)).toEqual(["d3", "d4"]);
  });
});

describe("draftsMatchingType", () => {
  it("narrows to the type about to be generated", () => {
    // "A client alert already exists" is a much stronger warning than
    // "something already exists".
    expect(draftsMatchingType(CORPUS, ["eo-1"], "client_alert").map((d) => d.id)).toEqual(["d1"]);
    expect(draftsMatchingType(CORPUS, ["eo-1"], "blog_post").map((d) => d.id)).toEqual(["d2"]);
  });

  it("is empty when the same order has drafts of other types only", () => {
    expect(draftsMatchingType(CORPUS, ["eo-1"], "social_post")).toEqual([]);
  });

  it("still finds a digest of the matching type", () => {
    expect(draftsMatchingType(CORPUS, ["eo-4"], "talking_points").map((d) => d.id)).toEqual(["d4"]);
  });
});
