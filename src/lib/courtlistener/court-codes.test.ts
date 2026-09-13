import { describe, expect, it } from "vitest";
import { normalizeCourtKey, resolveCourtId } from "@/lib/courtlistener/court-codes";

describe("normalizeCourtKey", () => {
  it("collapses the punctuation and spacing the firm varies", () => {
    expect(normalizeCourtKey("D.D.C.")).toBe("ddc");
    expect(normalizeCourtKey("D.D.C")).toBe("ddc");
    expect(normalizeCourtKey("D.DC")).toBe("ddc");
  });

  it("strips a trailing year some entries carry", () => {
    expect(normalizeCourtKey("N.D. Cal. 2025")).toBe(normalizeCourtKey("N.D. Cal."));
  });

  it("returns an empty key for an empty court", () => {
    expect(normalizeCourtKey("")).toBe("");
  });
});

describe("resolveCourtId", () => {
  // Every spelling below was observed in the live legal_challenges data.
  it.each([
    ["D.D.C.", "dcd"],
    ["D.D.C", "dcd"],
    ["D.DC", "dcd"],
    ["N.D. Cal.", "cand"],
    ["N.D. Cal. 2025", "cand"],
    ["S.D.N.Y.", "nysd"],
    ["D. Colo.", "cod"],
    ["D. Colorado", "cod"],
    ["N.D. Texas", "txnd"],
    ["N.D. Illinois", "ilnd"],
    ["W.D. Wash.", "wawd"],
    ["W.D.Wa.", "wawd"],
    ["Ct. Fed. Cl.", "uscfc"],
    ["Fed. Cl.", "uscfc"],
  ])("resolves %s to %s", (court, expected) => {
    expect(resolveCourtId(court)).toBe(expected);
  });

  it("resolves every spelling of Maryland, which CourtListener cites unabbreviated as 'D. Maryland'", () => {
    for (const spelling of ["D. Md.", "D.Md", "D.Md.", "D. Md"]) {
      expect(resolveCourtId(spelling)).toBe("mdd");
    }
  });

  it("resolves the bare and garbled Massachusetts spellings", () => {
    for (const spelling of ["D. Mass.", "D.Mass", "Mass", "Massachusetts", "D.C.D. Massachusetts"]) {
      expect(resolveCourtId(spelling)).toBe("mad");
    }
  });

  it("returns null rather than guessing when there is no court", () => {
    expect(resolveCourtId("")).toBeNull();
    expect(resolveCourtId(null)).toBeNull();
    expect(resolveCourtId(undefined)).toBeNull();
  });

  it("returns null for a court it doesn't recognize", () => {
    expect(resolveCourtId("Supreme Court of Narnia")).toBeNull();
  });
});
