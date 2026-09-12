import { INDUSTRIES, PRACTICE_AREAS, SUBJECT_AREAS } from "@/lib/taxonomy";
import {
  INDUSTRIES_PLACEHOLDER,
  PRACTICE_AREAS_PLACEHOLDER,
  SUBJECT_AREAS_PLACEHOLDER,
} from "@/lib/summary-prompt/default-prompt";

/**
 * Turns a stored prompt template into the system prompt actually sent to the
 * model, substituting the firm's fixed taxonomy lists.
 *
 * The lists live in code (src/config/*.json), not in the editable prompt
 * text, for one reason: parseSummaryResponse validates the model's answers
 * against those same lists and silently drops anything off-list. If someone
 * hand-typed the lists into the prompt, the two could drift and every
 * selection from the drifted list would vanish without explanation.
 */

function renderSubjectAreas(): string {
  return SUBJECT_AREAS.map((name) => `- ${name}`).join("\n");
}

function renderPracticeAreas(): string {
  return PRACTICE_AREAS.map((area) =>
    area.criteria ? `- ${area.name} — ${area.criteria}` : `- ${area.name}`,
  ).join("\n");
}

function renderIndustries(): string {
  return INDUSTRIES.map((name) => `- ${name}`).join("\n");
}

export function renderSummaryPrompt(template: string): string {
  return template
    .replaceAll(SUBJECT_AREAS_PLACEHOLDER, renderSubjectAreas())
    .replaceAll(PRACTICE_AREAS_PLACEHOLDER, renderPracticeAreas())
    .replaceAll(INDUSTRIES_PLACEHOLDER, renderIndustries());
}

export interface PromptValidation {
  /** Problems serious enough that saving is refused — the pipeline could not work. */
  errors: string[];
  /** Problems worth showing the editor but not worth blocking on. */
  warnings: string[];
}

/** Keys parseSummaryResponse requires; a prompt that never asks for them produces rows that always fail to parse. */
const REQUIRED_RESPONSE_KEYS = ["summary", "subjectArea", "practiceAreas", "industries"];

const PLACEHOLDER_WARNINGS: Array<{ placeholder: string; consequence: string }> = [
  {
    placeholder: SUBJECT_AREAS_PLACEHOLDER,
    consequence: "the model won't be shown the firm's subject-area list, and any topic it invents is dropped",
  },
  {
    placeholder: PRACTICE_AREAS_PLACEHOLDER,
    consequence: "the model won't be shown the practice-area list or its criteria, so practice areas will usually come back empty",
  },
  {
    placeholder: INDUSTRIES_PLACEHOLDER,
    consequence: "the model won't be shown the industries list, so industries will usually come back empty",
  },
];

/**
 * Checks a prompt before it's saved. This is the whole safety net for an
 * editable prompt: an edit that breaks the response contract wouldn't throw
 * at save time, it would quietly fail on every row of the next nightly run
 * (rule 4 — no secret failures), so the damage is caught here instead.
 */
export function validateSummaryPrompt(template: string): PromptValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (template.trim().length === 0) {
    return { errors: ["The prompt cannot be empty."], warnings };
  }

  const missingKeys = REQUIRED_RESPONSE_KEYS.filter((key) => !template.includes(key));
  if (missingKeys.length > 0) {
    errors.push(
      `The prompt must ask for every required JSON key. Missing: ${missingKeys.join(", ")}. Without them every summarization will fail to parse.`,
    );
  }

  if (!/\bJSON\b/i.test(template)) {
    errors.push(
      "The prompt must tell the model to respond with JSON only — the response is parsed as JSON, not read as prose.",
    );
  }

  for (const { placeholder, consequence } of PLACEHOLDER_WARNINGS) {
    if (!template.includes(placeholder)) {
      warnings.push(`${placeholder} is missing, so ${consequence}.`);
    }
  }

  return { errors, warnings };
}
