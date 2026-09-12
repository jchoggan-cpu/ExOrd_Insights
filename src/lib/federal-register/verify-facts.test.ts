import { describe, expect, it } from "vitest";
import {
  extractFacts,
  findUnsupportedFacts,
  normalizeForFactSearch,
} from "@/lib/federal-register/verify-facts";

describe("extractFacts", () => {
  it("picks out deadlines, money, percentages, citations, instruments and dates", () => {
    const kinds = extractFacts(
      'Within 90 days, importers paying the 50 percent duty and the $1 million fee under EO 14036 and 25 CFR part 83 must file by September 15, 2026.',
    ).map((f) => f.kind);

    expect(new Set(kinds)).toEqual(
      new Set(["deadline", "money", "percentage", "citation", "instrument", "date"]),
    );
  });

  it("does not report the same fact twice", () => {
    const facts = extractFacts("Within 90 days. Again within 90 days.");
    expect(facts.filter((f) => f.kind === "deadline")).toHaveLength(1);
  });

  it("finds nothing checkable in a summary with no hard facts", () => {
    expect(extractFacts("This proclamation designates a national week of observance.")).toEqual([]);
  });
});

describe("findUnsupportedFacts", () => {
  it("passes a figure that appears verbatim in the source", () => {
    expect(findUnsupportedFacts("Due within 90 days.", "shall report within 90 days of this order")).toEqual([]);
  });

  it("catches a deadline the source never states — the dangerous failure", () => {
    const unsupported = findUnsupportedFacts(
      "The Secretary shall report within 90 days.",
      "The Secretary shall report within 60 days of the date of this order.",
    );

    expect(unsupported).toHaveLength(1);
    expect(unsupported[0]).toMatchObject({ kind: "deadline", text: "90 days" });
  });

  it("accepts a percentage written differently than the source writes it", () => {
    expect(findUnsupportedFacts("a 50% duty", "an additional 50 percent ad valorem duty")).toEqual([]);
    expect(findUnsupportedFacts("a 50 percent duty", "an additional 50% ad valorem duty")).toEqual([]);
  });

  it("accepts a dollar figure whose thousands separators differ", () => {
    expect(findUnsupportedFacts("a $1,000,000 gift", "a gift of $1000000 or more")).toEqual([]);
  });

  it("accepts a date written in the source's ISO form", () => {
    expect(findUnsupportedFacts("effective September 15, 2026", "effective on 2026-09-15")).toEqual([]);
  });

  it("catches an invented executive order number", () => {
    const unsupported = findUnsupportedFacts(
      "This revokes EO 14036.",
      "This order revokes Executive Order 14099 of July 9, 2021.",
    );

    expect(unsupported.map((f) => f.kind)).toContain("instrument");
  });

  it("catches a citation to a provision the order never mentions", () => {
    const unsupported = findUnsupportedFacts(
      "issued under section 232 of the Trade Expansion Act",
      "issued under the authority of the International Emergency Economic Powers Act",
    );

    expect(unsupported.map((f) => f.kind)).toContain("citation");
  });

  it("is not fooled by smart quotes or non-breaking spaces in the source", () => {
    expect(findUnsupportedFacts("the 50 percent rate", "the 50 percent rate")).toEqual([]);
  });
});

describe("real false positives found auditing the tracker's 498 summarized rows", () => {
  it("accepts a digit deadline where the source spells the number out", () => {
    // EO 14151: source says "within sixty days", the summary says "60 days".
    expect(findUnsupportedFacts("Within 60 days, offices shall be terminated.", "shall take the following actions within sixty days of this order")).toEqual([]);
  });

  it("accepts a scaled dollar figure the source writes out in full", () => {
    // EO 14322: source says "$125,000,000", the summary says "$125 million".
    expect(findUnsupportedFacts("above $125 million in revenue", "revenues exceeding $125,000,000 in the 2024-2025 year")).toEqual([]);
  });

  it("accepts a percentage the source writes without a leading zero", () => {
    // EO 14403: source says ".15 percent", the summary says "0.15 percent".
    expect(findUnsupportedFacts("ratios of no more than 0.15 percent", "expenses, limited to .15 percent; and")).toEqual([]);
  });

  it("accepts a date whose year the summary supplies from context", () => {
    // Jewish American Heritage Month, 2026: the source writes "to nightfall on
    // May 16" and leaves the year to the masthead.
    expect(findUnsupportedFacts("to nightfall on May 16, 2026", "from sundown on May 15 to nightfall on May 16, friends and families")).toEqual([]);
  });

  it("does not swallow prose after a citation and then call the citation invented", () => {
    // The bug behind 18 of the first run's 19 flags.
    const unsupported = findUnsupportedFacts(
      "issued under 10 U.S.C. 12302 and related authorities",
      "the President may call units under 10 U.S.C. 12302 as needed",
    );
    expect(unsupported).toEqual([]);
  });

  it("accepts a U.S.C. citation the source writes in title form", () => {
    // Every citation flag in the first audit was this: the source says
    // "section 551(4), title 5, United States Code"; the summary reformats to
    // "5 U.S.C. 551(4)", which is correct and is what a law firm would write.
    expect(
      findUnsupportedFacts(
        'defined in 5 U.S.C. 551(4)',
        "``rule'' has the definition set forth in section 551(4), title 5, United States Code.",
      ),
    ).toEqual([]);
    expect(
      findUnsupportedFacts(
        "invokes 10 U.S.C. 12302",
        "that section 12302 of title 10, United States Code, is invoked and made available",
      ),
    ).toEqual([]);
  });

  it("accepts a CFR citation written as a part reference", () => {
    expect(findUnsupportedFacts("under 5 CFR 731.202(b)", "as provided in 5 CFR part 731.202(b)")).toEqual([]);
  });

  it("accepts a CFR cite whose periods and spacing differ from the source", () => {
    // EO 14210: source "5 C.F.R. 731.202(b)", summary "5 CFR 731.202(b)".
    expect(findUnsupportedFacts("revise 5 CFR 731.202(b)", "proposes to revise 5 C.F.R. 731.202(b) to include")).toEqual([]);
    // EO 14281: summary ran the cite together as "28 C.F.R.42.104(b)(2)".
    expect(findUnsupportedFacts("as applied to 28 C.F.R.42.104(b)(2)", "as applied to 28 C.F.R. 42.104(b)(2) in full")).toEqual([]);
  });

  it("accepts a CFR cite the source writes as a title-and-part reference", () => {
    // EO 14217: source "the regulations at title 5, part 960, Code of Federal
    // Regulations"; summary "5 CFR 960".
    expect(findUnsupportedFacts("withdraw 5 CFR 960", "withdraw the regulations at title 5, part 960, Code of Federal Regulations")).toEqual([]);
  });

  it("still catches a genuinely wrong number after all that leniency", () => {
    expect(
      findUnsupportedFacts("within 90 days", "shall report within sixty days of this order").map((f) => f.text),
    ).toEqual(["90 days"]);
  });
});

describe("normalizeForFactSearch", () => {
  it("collapses whitespace, quotes, dashes and thousands separators", () => {
    expect(normalizeForFactSearch("A  “quoted”  1,000 — thing")).toBe('a "quoted" 1000 - thing');
  });
});
