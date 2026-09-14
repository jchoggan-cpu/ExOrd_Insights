import type Anthropic from "@anthropic-ai/sdk";
import { extractTextBlock } from "@/lib/ai-model";
import { INDUSTRIES, PRACTICE_AREA_NAMES } from "@/lib/taxonomy";
import { toTokenUsage, type TokenUsage } from "@/lib/usage/pricing";

/**
 * One classification call and the validation of what comes back.
 *
 * Writes only practice areas and industries — never a summary. That is the
 * whole point of this file existing alongside summarize.ts: 338 of the
 * tracker's summaries are the firm's own curated text, and re-tagging must
 * not be able to touch them.
 */

export interface ClassifyInput {
  title: string;
  actionType: string;
  /**
   * The order's own text where we have it, otherwise its summary. 116 rows
   * have no full text, and excluding them would leave exactly the firm's
   * oldest records untagged.
   */
  sourceText: string;
  /** True when sourceText is a summary rather than the instrument itself — the model is told, so it can judge accordingly. */
  sourceIsSummary: boolean;
}

export interface ClassifyResult {
  practiceAreas: string[];
  industries: string[];
}

/**
 * The reply is two short arrays, but the ceiling has to cover the model's
 * thinking as well — it is billed and counted as output. Sized at 2000 this
 * truncated 4 of 614 rows on Sonnet 5, and the truncation surfaced as
 * "response was not valid JSON" because the cut landed mid-object. Room for
 * thinking costs nothing on runs that don't use it: only tokens actually
 * generated are billed.
 */
export const CLASSIFY_MAX_TOKENS = 8000;

/**
 * Strips a Markdown code fence if the model wrapped its JSON in one.
 *
 * Measured, not defensive: asked for bare JSON, Claude Fable 5 returns it,
 * but Haiku 4.5 reliably answers with ```json ... ``` — good JSON in a
 * wrapper. Tolerating the wrapper is what lets the same classifier run on
 * any model, which is the whole point of routing this task separately.
 */
const CODE_FENCE = /^\s*```(?:json)?\s*([\s\S]*?)\s*```\s*$/;

function stripCodeFence(rawText: string): string {
  return rawText.match(CODE_FENCE)?.[1] ?? rawText;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
}

/**
 * Keeps only values on the firm's fixed lists, and drops duplicates.
 * A code check rather than a prompt instruction: these columns are filtered
 * on, so one invented or misspelled tag would create a filter value that
 * matches a single row and looks like a real category.
 */
function onlyFromList(values: unknown, allowed: string[]): string[] {
  return [...new Set(asStringArray(values).filter((v) => allowed.includes(v)))];
}

/**
 * Validates the model's raw response. Throws on anything that isn't the
 * agreed shape rather than defaulting to empty arrays — an unnoticed parse
 * failure would look exactly like "this order has no practice areas", which
 * is the very problem this run exists to fix.
 */
export function parseClassifyResponse(rawText: string): ClassifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(stripCodeFence(rawText));
  } catch {
    throw new Error("Classification response was not valid JSON.");
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new Error("Classification response had an unexpected shape.");
  }

  const value = parsed as Record<string, unknown>;
  if (!Array.isArray(value.practiceAreas) || !Array.isArray(value.industries)) {
    throw new Error("Classification response was missing practiceAreas or industries.");
  }

  return {
    practiceAreas: onlyFromList(value.practiceAreas, PRACTICE_AREA_NAMES),
    industries: onlyFromList(value.industries, INDUSTRIES),
  };
}

export interface ClassifyOutcome {
  result: ClassifyResult;
  /** Returned rather than recorded here, so the caller owns the database (rule 2). */
  usage: TokenUsage;
}

export interface ClassifyDocumentParams {
  client: Anthropic;
  model: string;
  systemPrompt: string;
  input: ClassifyInput;
}

export async function classifyDocument({
  client,
  model,
  systemPrompt,
  input,
}: ClassifyDocumentParams): Promise<ClassifyOutcome> {
  const sourceLabel = input.sourceIsSummary
    ? "Summary (the full text of this instrument is not available):"
    : "Full text:";

  const response = await client.messages.create({
    model,
    max_tokens: CLASSIFY_MAX_TOKENS,
    // Cached for the same reason the summarization prompt is: it is identical
    // on every one of 600+ calls. Watch cache_read_input_tokens on /usage —
    // if it stays at zero the caching is silently doing nothing.
    system: [{ type: "text", text: systemPrompt, cache_control: { type: "ephemeral" } }],
    messages: [
      {
        role: "user",
        content: `${input.actionType} titled "${input.title}".\n\n${sourceLabel}\n${input.sourceText}`,
      },
    ],
  });

  // Checked before parsing, because a truncated response is usually still
  // *syntactically* broken JSON — reporting that as a parse failure sent a
  // real 4-row failure down the wrong diagnosis until the token ceiling was
  // found. Say what actually happened.
  if (response.stop_reason === "max_tokens") {
    throw new Error(
      `Classification response was cut off at the ${CLASSIFY_MAX_TOKENS}-token ceiling before it finished.`,
    );
  }

  return {
    result: parseClassifyResponse(extractTextBlock(response)),
    usage: toTokenUsage(response.usage),
  };
}
