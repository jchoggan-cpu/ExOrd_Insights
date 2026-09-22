import { describe, expect, it } from "vitest";
import { filterOptions, type FilterOption } from "@/components/multi-select-filter";

const OPTIONS: FilterOption[] = [
  { value: "Trade", label: "Trade" },
  { value: "Environment/Energy", label: "Environment/Energy" },
  { value: "National Security/Defense", label: "National Security/Defense" },
  { value: "Governmental--National Security", label: "National Security", isSubOption: true },
];

describe("filterOptions", () => {
  it("returns everything for an empty or whitespace term", () => {
    expect(filterOptions(OPTIONS, "")).toEqual(OPTIONS);
    expect(filterOptions(OPTIONS, "   ")).toEqual(OPTIONS);
  });

  it("matches case-insensitively on what the reader sees", () => {
    expect(filterOptions(OPTIONS, "env").map((o) => o.value)).toEqual(["Environment/Energy"]);
    expect(filterOptions(OPTIONS, "ENV").map((o) => o.value)).toEqual(["Environment/Energy"]);
  });

  it("matches anywhere in the name, not just the start", () => {
    expect(filterOptions(OPTIONS, "energy").map((o) => o.value)).toEqual(["Environment/Energy"]);
  });

  it("finds a subgroup by its parent's name, which only appears in the value", () => {
    // Stored as "Governmental--National Security" but labelled just
    // "National Security", so searching "governmental" must still find it.
    expect(filterOptions(OPTIONS, "governmental").map((o) => o.label)).toEqual([
      "National Security",
    ]);
  });

  it("returns nothing when nothing matches", () => {
    expect(filterOptions(OPTIONS, "zzz")).toEqual([]);
  });

  it("keeps a selected option visible even when it does not match", () => {
    // Otherwise its checkbox vanishes mid-search and the only way to untick
    // it is "Clear", which drops every other selection too.
    const result = filterOptions(OPTIONS, "env", ["Trade"]);
    expect(result.map((o) => o.value)).toEqual(["Trade", "Environment/Energy"]);
  });

  it("does not duplicate an option that both matches and is selected", () => {
    const result = filterOptions(OPTIONS, "env", ["Environment/Energy"]);
    expect(result.map((o) => o.value)).toEqual(["Environment/Energy"]);
  });
});
