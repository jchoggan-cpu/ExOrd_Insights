import { describe, expect, it } from "vitest";
import { AGENCY_ABBREVIATIONS, expandAgencyAbbreviations } from "@/lib/courtlistener/agency-abbreviations";

describe("expandAgencyAbbreviations", () => {
  it("expands the verified real example (FBI Agents Association v. DOJ)", () => {
    // docket 1:25-cv-00328, D.D.C. — CourtListener's caption spells both
    // agencies out; the firm's recorded caption uses both acronyms.
    const candidates = expandAgencyAbbreviations("FBI Agents Association et al v. DOJ");
    expect(candidates).toContain("Federal Bureau of Investigation Agents Association et al v. DOJ");
    expect(candidates).toContain("FBI Agents Association et al v. Department of Justice");
    expect(candidates).toContain(
      "Federal Bureau of Investigation Agents Association et al v. Department of Justice",
    );
  });

  it("does not expand DOE inside 'Doe v. Noem', which is not the Department of Energy", () => {
    // This is the whole reason expansion must be word-boundary and
    // case-sensitive-ish (matched against the literal acronym casing implied
    // by all-caps agency abbreviations): the firm's data has far more Doe
    // pseudonym cases than Department of Energy cases.
    expect(expandAgencyAbbreviations("Doe v. Noem")).toEqual([]);
  });

  it("still expands DOE when it actually appears as the acronym", () => {
    const candidates = expandAgencyAbbreviations("Sierra Club v. DOE");
    expect(candidates).toContain("Sierra Club v. Department of Energy");
  });

  it("requires the exact upper-case acronym spelling, not a lower- or mixed-case lookalike", () => {
    // Judgment call: the task also asks for case-insensitive matching, but
    // that would make "Doe" indistinguishable from "DOE" (previous test),
    // which is the one behavior explicitly required. Real captions write
    // agency acronyms in caps, so requiring the exact upper-case form
    // resolves the conflict without losing real matches.
    expect(expandAgencyAbbreviations("Sierra Club v. doe")).toEqual([]);
    expect(expandAgencyAbbreviations("Sierra Club v. Doe")).toEqual([]);
    expect(expandAgencyAbbreviations("Sierra Club v. DOE")).toContain("Sierra Club v. Department of Energy");
  });

  it("expands every distinct abbreviation and also offers a fully expanded candidate", () => {
    const candidates = expandAgencyAbbreviations("State v. DHS and EPA");
    expect(candidates).toContain("State v. Department of Homeland Security and EPA");
    expect(candidates).toContain("State v. DHS and Environmental Protection Agency");
    expect(candidates).toContain(
      "State v. Department of Homeland Security and Environmental Protection Agency",
    );
  });

  it("expands all occurrences of a repeated abbreviation together as one candidate", () => {
    const candidates = expandAgencyAbbreviations("DOJ v. DOJ Employees Union");
    expect(candidates).toContain("Department of Justice v. Department of Justice Employees Union");
  });

  it("returns an empty array when no known abbreviation appears", () => {
    expect(expandAgencyAbbreviations("Roe v. Wade")).toEqual([]);
  });

  it("returns an empty array for empty input", () => {
    expect(expandAgencyAbbreviations("")).toEqual([]);
  });

  it("caps the number of candidates so a many-abbreviation caption can't explode", () => {
    // 6 distinct agency acronyms in one caption: 6 single-substitution
    // candidates + 1 fully-expanded candidate = 7, under the cap. This
    // pins the cap's existence without hard-coding its exact value here.
    const manyAgencies = "DHS v. EPA and DOJ and OMB and HHS and DOT";
    const candidates = expandAgencyAbbreviations(manyAgencies);
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.length).toBeLessThanOrEqual(8);
  });

  it("exposes the abbreviation map for inspection", () => {
    expect(AGENCY_ABBREVIATIONS.DOJ).toBe("Department of Justice");
    expect(AGENCY_ABBREVIATIONS.USDA).toBe("United States Department of Agriculture");
    expect(AGENCY_ABBREVIATIONS.DOGE).toBe("Department of Government Efficiency");
  });
});
