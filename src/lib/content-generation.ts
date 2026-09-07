import Anthropic from "@anthropic-ai/sdk";
import type { ContentType, ExecutiveOrder } from "@/lib/types";
import { CONTENT_TYPE_LABELS } from "@/lib/types";
import { findUnverifiedQuotes } from "@/lib/federal-register/quote-verify";
import { extractTextBlock, getConfiguredModel } from "@/lib/ai-model";

// Content-type-specific length guidance and an output-token ceiling. Kept
// short since these are drafts a human will edit, not final copy.
const CONTENT_TYPE_GUIDANCE: Record<ContentType, { instructions: string; maxTokens: number }> = {
  client_alert: {
    instructions:
      "Write a formal client alert / legal memo in firm voice: a short headline, an 'At a Glance' bullet summary, then sections covering what the order does, who it affects, key deadlines, and recommended client action items. Cite specific dates and deliverables only if present in the provided data.",
    maxTokens: 4096,
  },
  blog_post: {
    instructions:
      "Write a longer-form blog post for the firm's website: an engaging headline, an introduction giving context, a body explaining the order's substance and implications, and a brief closing. More narrative and accessible than a client alert, still accurate and professional.",
    maxTokens: 6144,
  },
  talking_points: {
    instructions:
      "Write a short internal briefing: 5-10 concise bullet points an attorney could use in a client conversation, covering what changed, who's affected, and any open legal risk (e.g. pending litigation). No headline needed.",
    maxTokens: 2048,
  },
  social_post: {
    instructions:
      "Write one LinkedIn-style post (roughly 80-150 words): a hook, the key takeaway in plain language, and a soft call-to-action to read more or contact the firm. No hashtags unless natural. No headline.",
    maxTokens: 1024,
  },
};

const DEFAULT_STYLE_GUIDE =
  "Professional, precise law-firm voice. Confident but not alarmist. Avoid hedging filler ('it is important to note that'). Write for a sophisticated business/legal audience unless the content type calls for a more general one (e.g. social post).";

function formatEoForPrompt(eo: ExecutiveOrder): string {
  const lines = [
    eo.eoNumber ? `EO Number: ${eo.eoNumber}` : `Action Type: ${eo.actionType ?? "Unspecified"}`,
    `Title: ${eo.title}`,
    `Status: ${eo.status}`,
    `Date Signed: ${eo.dateSigned || "unknown"}`,
    eo.aiSummary ? `Summary: ${eo.aiSummary}` : null,
    eo.deliverable ? `Deliverable: ${eo.deliverable}` : null,
    eo.timelineNotes ? `Timeline: ${eo.timelineNotes}` : null,
    eo.agenciesImpacted.length ? `Agencies Impacted: ${eo.agenciesImpacted.join(", ")}` : null,
    eo.keyDates.length
      ? `Key Dates: ${eo.keyDates.map((k) => `${k.label} (${k.date})`).join("; ")}`
      : null,
    eo.legalChallenges.length
      ? `Legal Challenges: ${eo.legalChallenges
          .map((lc) => `${lc.caseName} — ${lc.status} (${lc.court}): ${lc.summary}`)
          .join(" | ")}`
      : "Legal Challenges: none on file",
    eo.newsMentions.length
      ? `News Coverage: ${eo.newsMentions.map((n) => `"${n.title}" (${n.source}, ${n.date})`).join(" | ")}`
      : null,
    eo.practiceAreas.length ? `Relevant Practice Areas: ${eo.practiceAreas.join(", ")}` : null,
    eo.industries.length ? `Relevant Industries: ${eo.industries.join(", ")}` : null,
  ].filter(Boolean);

  return lines.join("\n");
}

function buildSystemPrompt(styleGuide: string): string {
  return [
    "You are a legal content drafting assistant for a law firm's executive order tracker.",
    "You write draft content ONLY from the structured executive order data provided in the user message.",
    "",
    "Grounding rules (critical):",
    "- Never invent facts, case names, dates, deadlines, or figures that are not present in the provided data.",
    "- If the data needed for a strong draft is missing (e.g. no summary, no litigation info), write around the gap or note it briefly — do not fabricate specifics to fill it.",
    "- If multiple executive orders are provided, synthesize them into one cohesive piece rather than listing them as disconnected items, unless the content type calls for separate sections.",
    "",
    `Firm style guide: ${styleGuide}`,
    "",
    "Output only the draft content itself — no preamble like 'Here is a draft', no meta-commentary, no markdown headers unless natural for the content type.",
  ].join("\n");
}

export interface GenerateContentParams {
  orders: ExecutiveOrder[];
  contentType: ContentType;
  styleGuide?: string;
}

export interface GenerateContentResult {
  draftText: string;
  isStub: boolean;
  /**
   * Quoted substrings in draftText that don't appear verbatim in the
   * referenced order(s)' full_text. Only checked when full_text exists
   * (Federal Register ingestion, Phase 2) — empty for orders imported
   * before that, not because their quotes are verified. Surfaced to the
   * attorney's review pass, never used to block generation: paraphrases
   * aren't checked, only literal quoted material, since that's the only
   * thing a string match can honestly verify.
   */
  unverifiedQuotes: string[];
  /** False when none of the referenced orders have full_text yet — an empty unverifiedQuotes then means "not checked," not "verified clean," and the UI must not conflate the two. */
  quotesWereChecked: boolean;
}

function buildStubDraft(orders: ExecutiveOrder[], contentType: ContentType): string {
  const titles = orders.map((eo) => `${eo.eoNumber ?? eo.actionType ?? "Action"} — ${eo.title}`).join("; ");
  return [
    `[Stub draft — ${CONTENT_TYPE_LABELS[contentType]}]`,
    "",
    `This is placeholder text standing in for an AI-generated draft about: ${titles}.`,
    "",
    "Set the ANTHROPIC_API_KEY environment variable to enable real AI-generated drafts (see README).",
  ].join("\n");
}

/**
 * Generates draft content for one or more executive orders. Returns a
 * clearly-labeled stub when ANTHROPIC_API_KEY isn't configured, so the UI
 * is usable before that's set up.
 */
export async function generateContent({
  orders,
  contentType,
  styleGuide = DEFAULT_STYLE_GUIDE,
}: GenerateContentParams): Promise<GenerateContentResult> {
  if (orders.length === 0) {
    throw new Error("At least one executive order is required to generate content.");
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return { draftText: buildStubDraft(orders, contentType), isStub: true, unverifiedQuotes: [], quotesWereChecked: false };
  }

  const { instructions, maxTokens } = CONTENT_TYPE_GUIDANCE[contentType];
  const client = new Anthropic();

  const userPrompt = [
    `Content type: ${CONTENT_TYPE_LABELS[contentType]}`,
    `Instructions: ${instructions}`,
    "",
    "Executive order data:",
    "---",
    orders.map(formatEoForPrompt).join("\n---\n"),
  ].join("\n");

  const response = await client.messages.create({
    model: getConfiguredModel(),
    max_tokens: maxTokens,
    system: buildSystemPrompt(styleGuide),
    messages: [{ role: "user", content: userPrompt }],
  });

  const draftText = extractTextBlock(response);

  return {
    draftText,
    isStub: false,
    ...computeUnverifiedQuotes(draftText, orders),
  };
}

/** Checks draftText's quoted material against the concatenated full_text of every referenced order. */
export function computeUnverifiedQuotes(
  draftText: string,
  orders: ExecutiveOrder[],
): { unverifiedQuotes: string[]; quotesWereChecked: boolean } {
  const combinedSourceText = orders
    .map((eo) => eo.fullText)
    .filter(Boolean)
    .join("\n\n");
  if (!combinedSourceText) return { unverifiedQuotes: [], quotesWereChecked: false };
  return { unverifiedQuotes: findUnverifiedQuotes(draftText, combinedSourceText), quotesWereChecked: true };
}
