import { describe, expect, it } from "vitest";
import { renderSummaryPrompt, validateSummaryPrompt } from "@/lib/summary-prompt/render";
import { DEFAULT_SUMMARY_PROMPT } from "@/lib/summary-prompt/default-prompt";
import { INDUSTRIES, PRACTICE_AREAS, SUBJECT_AREAS } from "@/lib/taxonomy";

describe("renderSummaryPrompt", () => {
  it("substitutes every taxonomy placeholder", () => {
    const rendered = renderSummaryPrompt(DEFAULT_SUMMARY_PROMPT);

    expect(rendered).not.toContain("{{");
    expect(rendered).toContain(SUBJECT_AREAS[0]);
    expect(rendered).toContain(INDUSTRIES[0]);
    expect(rendered).toContain(PRACTICE_AREAS[0].name);
  });

  it("renders each practice area alongside its selection criteria", () => {
    const withCriteria = PRACTICE_AREAS.find((area) => area.criteria);
    expect(withCriteria).toBeDefined();

    const rendered = renderSummaryPrompt("{{PRACTICE_AREAS}}");
    expect(rendered).toContain(`- ${withCriteria!.name} — ${withCriteria!.criteria}`);
  });

  it("leaves a template with no placeholders untouched", () => {
    expect(renderSummaryPrompt("no placeholders here")).toBe("no placeholders here");
  });

  it("substitutes a placeholder used more than once", () => {
    const rendered = renderSummaryPrompt("{{INDUSTRIES}} and again {{INDUSTRIES}}");
    const occurrences = rendered.split(INDUSTRIES[0]).length - 1;
    expect(occurrences).toBe(2);
  });
});

describe("validateSummaryPrompt", () => {
  it("accepts the default prompt with no errors and no warnings", () => {
    expect(validateSummaryPrompt(DEFAULT_SUMMARY_PROMPT)).toEqual({ errors: [], warnings: [] });
  });

  it("rejects an empty prompt", () => {
    expect(validateSummaryPrompt("   ").errors).toEqual(["The prompt cannot be empty."]);
  });

  it("rejects a prompt that drops a required JSON key", () => {
    const broken = DEFAULT_SUMMARY_PROMPT.replaceAll("practiceAreas", "groups");
    const { errors } = validateSummaryPrompt(broken);

    expect(errors).toHaveLength(1);
    expect(errors[0]).toContain("practiceAreas");
  });

  it("rejects a prompt that never asks for JSON", () => {
    const { errors } = validateSummaryPrompt(
      "Write a summary with summary, subjectArea, practiceAreas, industries.",
    );
    expect(errors.some((e) => e.includes("JSON"))).toBe(true);
  });

  it("warns — but does not block — when a taxonomy placeholder is removed", () => {
    const withoutIndustries = DEFAULT_SUMMARY_PROMPT.replace("{{INDUSTRIES}}", "");
    const { errors, warnings } = validateSummaryPrompt(withoutIndustries);

    expect(errors).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("{{INDUSTRIES}}");
  });
});
