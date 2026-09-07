import { describe, expect, it } from "vitest";
import { parseSummaryResponse } from "@/lib/federal-register/summarize";
import { INDUSTRIES, PRACTICE_AREA_NAMES } from "@/lib/taxonomy";

describe("parseSummaryResponse", () => {
  it("parses a well-formed response using real fixed-list values", () => {
    const validPracticeArea = PRACTICE_AREA_NAMES[0];
    const validIndustry = INDUSTRIES[0];
    const raw = JSON.stringify({
      summary: "The order does X.",
      subjectArea: ["Trade Policy"],
      practiceAreas: [validPracticeArea],
      industries: [validIndustry],
    });

    expect(parseSummaryResponse(raw)).toEqual({
      summary: "The order does X.",
      subjectArea: ["Trade Policy"],
      practiceAreas: [validPracticeArea],
      industries: [validIndustry],
    });
  });

  it("silently drops a hallucinated practice area or industry not on the firm's fixed list", () => {
    const raw = JSON.stringify({
      summary: "The order does X.",
      subjectArea: ["Immigration"],
      practiceAreas: [PRACTICE_AREA_NAMES[0], "Space Law (Invented)"],
      industries: ["Not A Real Industry"],
    });

    const result = parseSummaryResponse(raw);

    expect(result.practiceAreas).toEqual([PRACTICE_AREA_NAMES[0]]);
    expect(result.industries).toEqual([]);
  });

  it("throws on invalid JSON rather than silently returning something", () => {
    expect(() => parseSummaryResponse("not json")).toThrow(/not valid JSON/);
  });

  it("throws when the JSON is well-formed but the wrong shape", () => {
    expect(() => parseSummaryResponse(JSON.stringify({ summary: 123 }))).toThrow(/unexpected shape/);
  });
});
