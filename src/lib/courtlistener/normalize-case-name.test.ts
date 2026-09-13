import { describe, expect, it } from "vitest";
import { normalizeCaseName, partiesLookAlike, splitParties } from "@/lib/courtlistener/normalize-case-name";

describe("normalizeCaseName", () => {
  it("makes the same case comparable however it is capitalized or punctuated", () => {
    // CourtListener returns captions upper-cased; the firm writes them mixed.
    expect(normalizeCaseName("J.G.G. v. TRUMP")).toBe(normalizeCaseName("J.G.G. v. Trump"));
  });

  it("normalizes every spelling of the versus separator", () => {
    const expected = "doe v noem";
    expect(normalizeCaseName("Doe v. Noem")).toBe(expected);
    expect(normalizeCaseName("Doe vs. Noem")).toBe(expected);
    expect(normalizeCaseName("Doe v Noem")).toBe(expected);
  });

  it("drops 'et al', which the firm includes and CourtListener usually doesn't", () => {
    expect(normalizeCaseName("State of California et al v. HHS et al")).toBe("state of california v hhs");
  });

  it("returns an empty string for missing input", () => {
    expect(normalizeCaseName(null)).toBe("");
    expect(normalizeCaseName(undefined)).toBe("");
  });
});

describe("splitParties", () => {
  it("splits a caption into its two sides", () => {
    expect(splitParties("Doe v. Noem")).toEqual({ plaintiff: "doe", defendant: "noem" });
  });

  it("splits on the first versus only, so a party containing 'v.' doesn't break it", () => {
    expect(splitParties("A v. B v. C")).toEqual({ plaintiff: "a", defendant: "b v c" });
  });

  it("returns null for a caption with no versus, rather than guessing", () => {
    expect(splitParties("In re Grand Jury Subpoena")).toBeNull();
    expect(splitParties("")).toBeNull();
  });
});

describe("partiesLookAlike", () => {
  it("accepts an identical party", () => {
    expect(partiesLookAlike("noem", "noem")).toBe(true);
  });

  it("accepts the firm's shortened institutional plaintiff against a fuller caption", () => {
    expect(partiesLookAlike("las americas immigrant advocacy center", "las americas immigrant advocacy center inc")).toBe(true);
  });

  it("rejects a party that merely appears inside an unrelated caption", () => {
    // The point of the prefix rule: "noem" inside "doe v noem" is not
    // evidence that "noem" is the same *plaintiff*.
    expect(partiesLookAlike("noem", "doe v noem")).toBe(false);
  });

  it("rejects a prefix that isn't on a word boundary", () => {
    expect(partiesLookAlike("trump", "trumpet society")).toBe(false);
  });

  it("rejects empty parties", () => {
    expect(partiesLookAlike("", "noem")).toBe(false);
  });
});
