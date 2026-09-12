/**
 * What a model call costs, so spend can be reported instead of guessed at.
 *
 * Rates are USD per million tokens, from Anthropic's published pricing. They
 * are a hardcoded snapshot: a price change upstream will NOT be picked up
 * automatically, and would make recorded costs wrong from that day forward.
 * Recorded rows keep the cost computed at the time of the call, so changing
 * this table never rewrites history — check it against the pricing page when
 * a bill looks off.
 */

export interface ModelRates {
  /** Uncached input. */
  inputPerMTok: number;
  outputPerMTok: number;
  /** Writing the cache costs more than plain input; reading it costs far less. */
  cacheWritePerMTok: number;
  cacheReadPerMTok: number;
}

/** The standard multipliers Anthropic applies to base input price for cache writes/reads. */
const CACHE_WRITE_MULTIPLIER = 1.25;
const CACHE_READ_MULTIPLIER = 0.1;

function rates(inputPerMTok: number, outputPerMTok: number): ModelRates {
  return {
    inputPerMTok,
    outputPerMTok,
    cacheWritePerMTok: inputPerMTok * CACHE_WRITE_MULTIPLIER,
    cacheReadPerMTok: inputPerMTok * CACHE_READ_MULTIPLIER,
  };
}

const MODEL_RATES: Record<string, ModelRates> = {
  "claude-fable-5": rates(10, 50),
  "claude-fable-5-1": rates(10, 50),
  "claude-opus-5": rates(5, 25),
  "claude-opus-4-8": rates(5, 25),
  "claude-sonnet-5": rates(2, 10),
  "claude-haiku-4-5": rates(1, 5),
};

/** Gateway model ids arrive provider-prefixed ("anthropic/claude-fable-5"); price them the same. */
function normalizeModelId(model: string): string {
  const slash = model.lastIndexOf("/");
  return slash === -1 ? model : model.slice(slash + 1);
}

export function getModelRates(model: string): ModelRates | null {
  return MODEL_RATES[normalizeModelId(model)] ?? null;
}

/** The token counts a cost is computed from — the subset of the SDK's usage object that carries a price. */
export interface TokenUsage {
  inputTokens: number;
  outputTokens: number;
  cacheCreationInputTokens: number;
  cacheReadInputTokens: number;
}

export interface CostBreakdown {
  costUsd: number;
  /** False when the model isn't in the table above — the call still happened, we just can't price it. */
  priced: boolean;
}

/**
 * Costs one call. An unknown model returns zero with `priced: false` rather
 * than throwing or silently guessing: a new model should show up as
 * "unpriced" in the UI, not as free (rule 4).
 */
export function calculateCost(model: string, usage: TokenUsage): CostBreakdown {
  const modelRates = getModelRates(model);
  if (!modelRates) return { costUsd: 0, priced: false };

  const costUsd =
    (usage.inputTokens * modelRates.inputPerMTok +
      usage.outputTokens * modelRates.outputPerMTok +
      usage.cacheCreationInputTokens * modelRates.cacheWritePerMTok +
      usage.cacheReadInputTokens * modelRates.cacheReadPerMTok) /
    1_000_000;

  return { costUsd, priced: true };
}

/**
 * Pulls the priced token counts out of an SDK response's `usage`.
 *
 * Tolerates a missing usage block entirely: metering is bookkeeping, and a
 * response shaped unexpectedly must not throw out of a summarization run
 * that otherwise succeeded. Such a call records as zero tokens, which the
 * ticker shows as a $0.00 call rather than hiding.
 */
export function toTokenUsage(
  usage:
    | {
        input_tokens?: number | null;
        output_tokens?: number | null;
        cache_creation_input_tokens?: number | null;
        cache_read_input_tokens?: number | null;
      }
    | null
    | undefined,
): TokenUsage {
  if (!usage) {
    return { inputTokens: 0, outputTokens: 0, cacheCreationInputTokens: 0, cacheReadInputTokens: 0 };
  }
  return {
    inputTokens: usage.input_tokens ?? 0,
    outputTokens: usage.output_tokens ?? 0,
    cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
    cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
  };
}
