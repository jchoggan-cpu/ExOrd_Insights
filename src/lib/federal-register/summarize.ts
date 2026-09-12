import type Anthropic from "@anthropic-ai/sdk";
import { extractTextBlock } from "@/lib/ai-model";
import { INDUSTRIES, PRACTICE_AREA_NAMES, SUBJECT_AREAS } from "@/lib/taxonomy";

/**
 * Sends one document to the model and validates what comes back.
 *
 * The system prompt is NOT built here any more — it's stored in
 * `summary_prompts`, edited in the app at /prompt, and passed in (rule 3).
 * That keeps this file responsible for one job: the call and the validation
 * of its response.
 */

export interface SummarizeInput {
  title: string;
  actionType: string;
  fullText: string;
}

/** One obligation the instrument places on a party outside the federal government. */
export interface Deliverable {
  action: string;
  /** "unclear" when the instrument creates the obligation but states no date. */
  deadline: string;
  responsibleParty: string;
}

export interface SummarizeResult {
  summary: string;
  subjectArea: string[];
  practiceAreas: string[];
  industries: string[];
  /**
   * Null when the instrument obliges no one outside the federal government
   * (the common case). `undefined` when the model was never asked or gave an
   * unusable answer — callers must NOT record that as "None.", which would
   * assert something nobody established. The prompt is editable, so a prompt
   * without a deliverables section is a real and expected state.
   */
  deliverables: Deliverable[] | null | undefined;
}

/**
 * Generous because the summarization model (Fable 5 by default) always
 * thinks, and thinking tokens are billed and counted as output. A ceiling
 * sized for the JSON alone would truncate the response mid-object and turn
 * every row into a parse failure.
 */
export const SUMMARY_MAX_TOKENS = 8000;

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Keeps only values on the firm's fixed list. A code check rather than a
 * prompt instruction, so a hallucinated tag can't corrupt the fixed-list
 * semantics these columns are supposed to guarantee — the prompt is editable
 * now, and an edit must not be able to loosen this.
 */
function onlyFromList(values: unknown, allowed: string[]): string[] {
  return asStringArray(values).filter((v) => allowed.includes(v));
}

function parseDeliverables(value: unknown): Deliverable[] | null | undefined {
  // Key absent (an edited prompt that no longer asks for deliverables) or a
  // shape we can't read — either way nothing was established, so say so
  // rather than reporting an obligation-free instrument.
  if (value === undefined) return undefined;
  if (value === null) return null;
  if (!Array.isArray(value)) return undefined;

  const deliverables = value.flatMap((entry): Deliverable[] => {
    if (typeof entry !== "object" || entry === null) return [];
    const { action, deadline, responsibleParty } = entry as Record<string, unknown>;
    // An entry without an action says nothing; one missing a deadline or a
    // party is still worth keeping, flagged, since a half-known obligation
    // is a review item rather than something to discard.
    if (typeof action !== "string" || action.trim() === "") return [];
    return [
      {
        action,
        deadline: typeof deadline === "string" && deadline.trim() !== "" ? deadline : "unclear",
        responsibleParty:
          typeof responsibleParty === "string" && responsibleParty.trim() !== ""
            ? responsibleParty
            : "unclear",
      },
    ];
  });

  // An empty array and an explicit null both mean "obliges no outside party".
  return deliverables.length > 0 ? deliverables : null;
}

/**
 * Validates and sanitizes the model's raw response. Throws on anything that
 * isn't recognizably the agreed shape — a parse failure is recorded against
 * the row and visible in Needs Attention, whereas a lenient parse would
 * write an empty summary nobody notices.
 */
export function parseSummaryResponse(rawText: string): SummarizeResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("Summarization response was not valid JSON.");
  }

  if (
    typeof parsed !== "object" ||
    parsed === null ||
    typeof (parsed as Record<string, unknown>).summary !== "string" ||
    !Array.isArray((parsed as Record<string, unknown>).subjectArea) ||
    !Array.isArray((parsed as Record<string, unknown>).practiceAreas) ||
    !Array.isArray((parsed as Record<string, unknown>).industries)
  ) {
    throw new Error("Summarization response had an unexpected shape.");
  }

  const value = parsed as Record<string, unknown>;

  return {
    summary: value.summary as string,
    subjectArea: onlyFromList(value.subjectArea, SUBJECT_AREAS),
    practiceAreas: onlyFromList(value.practiceAreas, PRACTICE_AREA_NAMES),
    industries: onlyFromList(value.industries, INDUSTRIES),
    deliverables: parseDeliverables(value.deliverables),
  };
}

export interface SummarizeDocumentParams {
  client: Anthropic;
  model: string;
  /** The rendered system prompt — see src/lib/summary-prompt/render.ts. */
  systemPrompt: string;
  input: SummarizeInput;
}

export async function summarizeDocument({
  client,
  model,
  systemPrompt,
  input,
}: SummarizeDocumentParams): Promise<SummarizeResult> {
  const response = await client.messages.create({
    model,
    max_tokens: SUMMARY_MAX_TOKENS,
    system: systemPrompt,
    messages: [
      {
        role: "user",
        content: `${input.actionType} titled "${input.title}".\n\nFull text:\n${input.fullText}`,
      },
    ],
  });

  return parseSummaryResponse(extractTextBlock(response));
}
