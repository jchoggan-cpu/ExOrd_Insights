import { describe, expect, it } from "vitest";
import { formatTagLabel } from "@/lib/tag-label";

describe("formatTagLabel", () => {
  it("leaves an ordinary tag alone", () => {
    expect(formatTagLabel("Trade")).toBe("Trade");
    expect(formatTagLabel("Environment/Energy")).toBe("Environment/Energy");
  });

  it("replaces the storage separator a reader should never see", () => {
    expect(formatTagLabel("Governmental--National Security")).toBe(
      "Governmental \u2013 National Security",
    );
  });

  it("keeps a single hyphen, which is part of the name", () => {
    // "Medium- and Heavy-Duty" style names must survive untouched.
    expect(formatTagLabel("Aerospace, Defense & Government Services")).toBe(
      "Aerospace, Defense & Government Services",
    );
    expect(formatTagLabel("Health-Care")).toBe("Health-Care");
  });
});
