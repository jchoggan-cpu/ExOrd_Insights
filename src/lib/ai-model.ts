import Anthropic from "@anthropic-ai/sdk";

/**
 * Single access point for the AI provider settings (rule 6). Two credential
 * sources are supported, checked in this order:
 *
 *  1. `AI_GATEWAY_API_KEY` — routes every call through Vercel's AI Gateway,
 *     which speaks the Anthropic Messages API verbatim, so the only changes
 *     are the base URL and a provider-prefixed model id. Gives one place
 *     (the Vercel dashboard) to watch spend and traffic.
 *  2. `ANTHROPIC_API_KEY` — talks to the Anthropic API directly.
 *
 * Neither set means no AI: callers check `hasAiCredentials()` and fall back
 * to stub output rather than throwing.
 */

const AI_GATEWAY_BASE_URL = "https://ai-gateway.vercel.sh";
/** The gateway addresses models as `<provider>/<model>`; the plain Anthropic API doesn't. */
const AI_GATEWAY_MODEL_PREFIX = "anthropic/";
/** Content drafting (client alerts, blog posts, talking points, social posts). */
const DEFAULT_CONTENT_MODEL = "claude-opus-5";
/**
 * Federal Register summarization and classification. Fable 5 is Anthropic's
 * most capable tier and runs ~2x Opus 5 per token, which is the deliberate
 * tradeoff here: these summaries are written once, read by attorneys, and
 * feed client-facing drafts, so accuracy outranks per-row cost. Thinking is
 * always on for the Fable family and its tokens are billed as output —
 * see SUMMARY_MAX_TOKENS in summarize.ts, which has to leave room for it.
 */
const DEFAULT_SUMMARY_MODEL = "claude-fable-5";
/**
 * Classification (practice areas and industries) — a different job from
 * summarization, and priced differently on purpose.
 *
 * Summarization writes prose an attorney reads, so it runs on the most
 * capable tier. Classification picks labels from two fixed lists, and the
 * cost profile is lopsided: measured on a 20-row pilot, Fable 5 charged
 * $0.048 a row for a two-array answer, because its thinking is always on and
 * billed as output. Routing this task separately is what lets a cheaper
 * model take it without touching summarization.
 */
const DEFAULT_CLASSIFY_MODEL = "claude-fable-5";

interface AiCredentials {
  apiKey: string;
  /** Set only when routing through the gateway; the Anthropic SDK's own default applies otherwise. */
  baseURL?: string;
  viaGateway: boolean;
}

function resolveCredentials(): AiCredentials | null {
  const gatewayKey = process.env.AI_GATEWAY_API_KEY;
  if (gatewayKey) {
    return { apiKey: gatewayKey, baseURL: AI_GATEWAY_BASE_URL, viaGateway: true };
  }

  const anthropicKey = process.env.ANTHROPIC_API_KEY;
  if (anthropicKey) {
    return { apiKey: anthropicKey, viaGateway: false };
  }

  return null;
}

/** True when either credential source is configured — the gate callers use before attempting a real model call. */
export function hasAiCredentials(): boolean {
  return resolveCredentials() !== null;
}

/** Human-readable name of the route in use, for logs and diagnostics. */
export function describeAiProvider(): string {
  const credentials = resolveCredentials();
  if (!credentials) return "none configured";
  return credentials.viaGateway ? "Vercel AI Gateway" : "Anthropic API (direct)";
}

/**
 * Builds a configured client. Throws rather than returning a half-working
 * client when nothing is configured — callers must check `hasAiCredentials()`
 * first, which is what lets the UI show a labeled stub instead of an error.
 */
export function createAnthropicClient(): Anthropic {
  const credentials = resolveCredentials();
  if (!credentials) {
    throw new Error(
      "No AI credentials configured — set AI_GATEWAY_API_KEY (Vercel AI Gateway) or ANTHROPIC_API_KEY (Anthropic direct).",
    );
  }
  return new Anthropic({ apiKey: credentials.apiKey, baseURL: credentials.baseURL });
}

/**
 * Normalizes a model id for whichever route is in use. An id may be written
 * with or without the `anthropic/` prefix — it's added or stripped to match,
 * so switching between the gateway and the direct API doesn't silently 404
 * on an id the other one doesn't recognize.
 */
function forCurrentRoute(configured: string): string {
  const bareModel = configured.startsWith(AI_GATEWAY_MODEL_PREFIX)
    ? configured.slice(AI_GATEWAY_MODEL_PREFIX.length)
    : configured;

  return resolveCredentials()?.viaGateway ? `${AI_GATEWAY_MODEL_PREFIX}${bareModel}` : bareModel;
}

/** The model used for content drafting. Override with `EO_TRACKER_MODEL`. */
export function getConfiguredModel(): string {
  return forCurrentRoute(process.env.EO_TRACKER_MODEL || DEFAULT_CONTENT_MODEL);
}

/**
 * The model used to summarize and classify Federal Register documents.
 * Deliberately separate from the content-drafting model so the two can be
 * priced and tuned independently. Override with `EO_TRACKER_SUMMARY_MODEL`.
 */
export function getSummaryModel(): string {
  return forCurrentRoute(process.env.EO_TRACKER_SUMMARY_MODEL || DEFAULT_SUMMARY_MODEL);
}

/**
 * The model used to classify documents into practice areas and industries.
 * Override with `EO_TRACKER_CLASSIFY_MODEL`.
 *
 * Separate from the summarization model so the two can move independently:
 * see DEFAULT_CLASSIFY_MODEL for why this task is priced differently.
 */
export function getClassifyModel(): string {
  return forCurrentRoute(process.env.EO_TRACKER_CLASSIFY_MODEL || DEFAULT_CLASSIFY_MODEL);
}

/** Pulls the text out of a Claude response, shared by content-generation.ts and summarize.ts — both need the same "did it actually return text" guard. */
export function extractTextBlock(response: Anthropic.Messages.Message): string {
  const textBlock = response.content.find((b) => b.type === "text");
  if (!textBlock || textBlock.type !== "text") {
    throw new Error(`Model did not return text (stop_reason: ${response.stop_reason}).`);
  }
  return textBlock.text;
}
