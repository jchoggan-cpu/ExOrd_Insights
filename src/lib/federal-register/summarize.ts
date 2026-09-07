import Anthropic from "@anthropic-ai/sdk";
import { extractTextBlock } from "@/lib/ai-model";
import { INDUSTRIES, PRACTICE_AREA_NAMES } from "@/lib/taxonomy";

export interface SummarizeInput {
  title: string;
  actionType: string;
  fullText: string;
}

export interface SummarizeResult {
  summary: string;
  subjectArea: string[];
  practiceAreas: string[];
  industries: string[];
}

function buildSystemPrompt(): string {
  return [
    "You summarize and classify a single executive order, proclamation, or memorandum for a law firm's internal tracker.",
    "You are a summarizer, not a legal analyst: describe what the document does, in plain factual terms, without drawing independent legal conclusions about its validity, effect, or merits.",
    "Any direct quotation you include in the summary must be copied verbatim from the provided full text — never paraphrase inside quotation marks.",
    "",
    `Practice Areas — choose only from this fixed list, as many as genuinely apply: ${PRACTICE_AREA_NAMES.join(", ")}`,
    `Industries — choose only from this fixed list, as many as genuinely apply: ${INDUSTRIES.join(", ")}`,
    'Subject Area — 1-4 short free-form topic tags in your own words (e.g. "Immigration", "Trade Policy"); this list is not fixed.',
    "",
    'Respond with ONLY a JSON object: { "summary": string, "subjectArea": string[], "practiceAreas": string[], "industries": string[] }. No other text.',
  ].join("\n");
}

/**
 * Validates and sanitizes the model's raw response. Silently drops any
 * practiceAreas/industries value outside the firm's fixed lists — a code
 * check, not a prompt instruction, so a hallucinated tag can't corrupt the
 * fixed-list semantics those two fields are supposed to guarantee.
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

  const value = parsed as {
    summary: string;
    subjectArea: unknown[];
    practiceAreas: unknown[];
    industries: unknown[];
  };

  return {
    summary: value.summary,
    subjectArea: value.subjectArea.filter((s): s is string => typeof s === "string"),
    practiceAreas: value.practiceAreas.filter(
      (p): p is string => typeof p === "string" && PRACTICE_AREA_NAMES.includes(p),
    ),
    industries: value.industries.filter((i): i is string => typeof i === "string" && INDUSTRIES.includes(i)),
  };
}

export async function summarizeDocument(
  client: Anthropic,
  model: string,
  input: SummarizeInput,
): Promise<SummarizeResult> {
  const response = await client.messages.create({
    model,
    max_tokens: 1024,
    system: buildSystemPrompt(),
    messages: [
      {
        role: "user",
        content: `${input.actionType} titled "${input.title}".\n\nFull text:\n${input.fullText}`,
      },
    ],
  });

  return parseSummaryResponse(extractTextBlock(response));
}
