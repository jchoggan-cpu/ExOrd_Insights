import { describe, expect, it } from "vitest";
import { parseSummaryResponse } from "@/lib/federal-register/summarize";
import { INDUSTRIES, PRACTICE_AREA_NAMES, SUBJECT_AREAS } from "@/lib/taxonomy";

describe("parseSummaryResponse", () => {
  it("parses a well-formed response using real fixed-list values", () => {
    const validPracticeArea = PRACTICE_AREA_NAMES[0];
    const validIndustry = INDUSTRIES[0];
    const validSubjectArea = SUBJECT_AREAS[0];
    const raw = JSON.stringify({
      summary: "The order does X.",
      subjectArea: [validSubjectArea],
      practiceAreas: [validPracticeArea],
      industries: [validIndustry],
      deliverables: null,
    });

    expect(parseSummaryResponse(raw)).toEqual({
      summary: "The order does X.",
      subjectArea: [validSubjectArea],
      practiceAreas: [validPracticeArea],
      industries: [validIndustry],
      deliverables: null,
    });
  });

  it("drops a subject area that isn't on the firm's fixed list", () => {
    // "Trade" is on the list; "Trade Policy" is the kind of near-miss the
    // model invented freely before 0005 fixed this column to a list.
    const raw = JSON.stringify({
      summary: "The order does X.",
      subjectArea: ["Trade Policy", SUBJECT_AREAS[0]],
      practiceAreas: [],
      industries: [],
    });

    expect(parseSummaryResponse(raw).subjectArea).toEqual([SUBJECT_AREAS[0]]);
  });

  it("parses deliverables, filling 'unclear' for a missing deadline or party", () => {
    const raw = JSON.stringify({
      summary: "The order does X.",
      subjectArea: [],
      practiceAreas: [],
      industries: [],
      deliverables: [
        { action: "pay the new tariff", deadline: "30 days", responsibleParty: "Importers" },
        { action: "register with Commerce" },
      ],
    });

    expect(parseSummaryResponse(raw).deliverables).toEqual([
      { action: "pay the new tariff", deadline: "30 days", responsibleParty: "Importers" },
      { action: "register with Commerce", deadline: "unclear", responsibleParty: "unclear" },
    ]);
  });

  it("treats an explicitly empty or actionless deliverables list as null — 'obliges no outside party'", () => {
    const base = { summary: "X.", subjectArea: [], practiceAreas: [], industries: [] };

    expect(parseSummaryResponse(JSON.stringify({ ...base, deliverables: null })).deliverables).toBeNull();
    expect(parseSummaryResponse(JSON.stringify({ ...base, deliverables: [] })).deliverables).toBeNull();
    expect(
      parseSummaryResponse(JSON.stringify({ ...base, deliverables: [{ deadline: "30 days" }] })).deliverables,
    ).toBeNull();
  });

  it("distinguishes 'never answered' from 'no deliverables' so callers can't assert 'None.' either way", () => {
    const base = { summary: "X.", subjectArea: [], practiceAreas: [], industries: [] };

    // An edited prompt that no longer asks for deliverables, or an answer in
    // a shape we can't read — neither establishes that nothing is owed.
    expect(parseSummaryResponse(JSON.stringify(base)).deliverables).toBeUndefined();
    expect(
      parseSummaryResponse(JSON.stringify({ ...base, deliverables: "None" })).deliverables,
    ).toBeUndefined();
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
