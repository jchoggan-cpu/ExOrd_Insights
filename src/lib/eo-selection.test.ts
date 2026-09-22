import { describe, expect, it } from "vitest";
import {
  draftHrefFor,
  isSelected,
  parseStoredSelection,
  selectionLabel,
  serializeSelection,
  toggleSelection,
} from "@/lib/eo-selection";

describe("toggleSelection", () => {
  it("adds an order that was not selected", () => {
    expect(toggleSelection([], "a")).toEqual(["a"]);
    expect(toggleSelection(["a"], "b")).toEqual(["a", "b"]);
  });

  it("removes one that was", () => {
    expect(toggleSelection(["a", "b", "c"], "b")).toEqual(["a", "c"]);
  });

  it("keeps the order things were ticked in", () => {
    let selected: string[] = [];
    for (const id of ["c", "a", "b"]) selected = toggleSelection(selected, id);
    expect(selected).toEqual(["c", "a", "b"]);
  });

  it("does not mutate what it was given", () => {
    const original = ["a"];
    toggleSelection(original, "b");
    expect(original).toEqual(["a"]);
  });
});

describe("draftHrefFor", () => {
  it("sends one parameter per order", () => {
    expect(draftHrefFor(["a", "b"])).toBe("/draft?eoId=a&eoId=b");
  });

  it("goes to the bare drafter when nothing is selected", () => {
    expect(draftHrefFor([])).toBe("/draft");
  });

  it("escapes ids rather than pasting them into a URL raw", () => {
    // Live ids are UUIDs and legacy ones are "legacy-eo-N", so neither needs
    // escaping today -- which is exactly when this stops being tested by use.
    expect(draftHrefFor(["a b", "c&d=e"])).toBe("/draft?eoId=a+b&eoId=c%26d%3De");
  });
});

describe("parseStoredSelection", () => {
  it("round-trips a real selection", () => {
    const ids = ["11111111-2222-3333-4444-555555555555", "legacy-eo-7"];
    expect(parseStoredSelection(serializeSelection(ids))).toEqual(ids);
  });

  it("treats nothing stored as nothing selected", () => {
    expect(parseStoredSelection(null)).toEqual([]);
    expect(parseStoredSelection("")).toEqual([]);
  });

  it("recovers from anything else in storage instead of throwing", () => {
    // sessionStorage is editable by hand and survives a format change; an
    // exception here would take down every tracker render.
    expect(parseStoredSelection("not json")).toEqual([]);
    expect(parseStoredSelection("{}")).toEqual([]);
    expect(parseStoredSelection('"a"')).toEqual([]);
    expect(parseStoredSelection("42")).toEqual([]);
  });

  it("drops entries that are not usable ids", () => {
    expect(parseStoredSelection('["a", 7, null, "", "b", {"id":"c"}]')).toEqual(["a", "b"]);
  });

  it("de-duplicates", () => {
    expect(parseStoredSelection('["a","b","a"]')).toEqual(["a", "b"]);
  });
});

describe("isSelected and selectionLabel", () => {
  it("reports membership", () => {
    expect(isSelected(["a", "b"], "b")).toBe(true);
    expect(isSelected(["a", "b"], "c")).toBe(false);
  });

  it("pluralizes", () => {
    expect(selectionLabel(1)).toBe("1 order");
    expect(selectionLabel(3)).toBe("3 orders");
    expect(selectionLabel(0)).toBe("0 orders");
  });
});
