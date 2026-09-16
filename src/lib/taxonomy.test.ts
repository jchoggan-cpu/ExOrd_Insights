import { describe, expect, it } from "vitest";
import {
  PRACTICE_AREA_NAMES,
  PRACTICE_AREA_TAGS,
  PRACTICE_AREAS,
  PRACTICE_AREAS_WITH_SUBPRACTICES,
  parentPracticeOf,
  subPracticeTag,
} from "@/lib/taxonomy";

describe("subPracticeTag", () => {
  it("joins a parent and its subgroup into the stored form", () => {
    expect(subPracticeTag("Governmental", "National Security")).toBe("Governmental--National Security");
  });
});

describe("parentPracticeOf", () => {
  it("returns the parent of a subgroup tag", () => {
    expect(parentPracticeOf("Governmental--National Security")).toBe("Governmental");
  });

  it("returns a plain practice area unchanged", () => {
    expect(parentPracticeOf("Tax")).toBe("Tax");
  });

  it("splits on the first separator only, so a subgroup name may contain one", () => {
    expect(parentPracticeOf("Governmental--Life Sciences / FDA")).toBe("Governmental");
  });
});

describe("PRACTICE_AREA_TAGS", () => {
  it("includes every plain practice area", () => {
    for (const name of PRACTICE_AREA_NAMES) {
      expect(PRACTICE_AREA_TAGS).toContain(name);
    }
  });

  it("includes a compound tag for each Governmental subgroup", () => {
    const governmental = PRACTICE_AREAS.find((area) => area.name === "Governmental");
    expect(governmental?.subPractices?.length).toBeGreaterThan(0);

    for (const sub of governmental?.subPractices ?? []) {
      expect(PRACTICE_AREA_TAGS).toContain(`Governmental--${sub.name}`);
    }
  });

  it("keeps the bare parent valid alongside its subgroups", () => {
    // An order can be Governmental without fitting any one subgroup, and
    // forcing a subgroup there would mean recording a guess.
    expect(PRACTICE_AREA_TAGS).toContain("Governmental");
  });

  it("excludes subgroups that carry no criteria of their own", () => {
    // Litigation lists subpractices but no guidance for them, so the model is
    // never shown them and must never be able to return one.
    const litigation = PRACTICE_AREAS.find((area) => area.name === "Litigation");
    expect(litigation?.subPractices?.length).toBeGreaterThan(0);

    for (const sub of litigation?.subPractices ?? []) {
      if (!sub.criteria) {
        expect(PRACTICE_AREA_TAGS).not.toContain(`Litigation--${sub.name}`);
      }
    }
  });

  it("offers subgroups only for areas that wrote criteria for them", () => {
    for (const parent of PRACTICE_AREAS_WITH_SUBPRACTICES) {
      expect(parent.subPractices?.some((sub) => sub.criteria)).toBe(true);
    }
  });

  it("has no duplicates", () => {
    expect(new Set(PRACTICE_AREA_TAGS).size).toBe(PRACTICE_AREA_TAGS.length);
  });
});
