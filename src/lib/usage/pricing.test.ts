import { describe, expect, it } from "vitest";
import { calculateCost, getModelRates, toTokenUsage } from "@/lib/usage/pricing";

const NO_USAGE = {
  inputTokens: 0,
  outputTokens: 0,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 0,
};

describe("calculateCost", () => {
  it("prices input and output at the model's published rates", () => {
    // Fable 5: $10/MTok in, $50/MTok out.
    const { costUsd, priced } = calculateCost("claude-fable-5", {
      ...NO_USAGE,
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
    });

    expect(priced).toBe(true);
    expect(costUsd).toBeCloseTo(60, 6);
  });

  it("charges a cache read at a tenth of the input rate — the whole point of caching the prompt", () => {
    const uncached = calculateCost("claude-fable-5", { ...NO_USAGE, inputTokens: 1_000_000 });
    const cached = calculateCost("claude-fable-5", { ...NO_USAGE, cacheReadInputTokens: 1_000_000 });

    expect(uncached.costUsd).toBeCloseTo(10, 6);
    expect(cached.costUsd).toBeCloseTo(1, 6);
  });

  it("charges a cache write at a premium over plain input", () => {
    const write = calculateCost("claude-fable-5", { ...NO_USAGE, cacheCreationInputTokens: 1_000_000 });
    expect(write.costUsd).toBeCloseTo(12.5, 6);
  });

  it("prices a gateway-prefixed model id the same as the bare one", () => {
    const bare = calculateCost("claude-fable-5", { ...NO_USAGE, inputTokens: 500_000 });
    const prefixed = calculateCost("anthropic/claude-fable-5", { ...NO_USAGE, inputTokens: 500_000 });

    expect(prefixed.costUsd).toBe(bare.costUsd);
  });

  it("reports an unknown model as unpriced rather than free", () => {
    const { costUsd, priced } = calculateCost("claude-not-released-yet", {
      ...NO_USAGE,
      inputTokens: 1_000_000,
    });

    // Zero AND priced:false — a new model must surface as "we can't price
    // this", never as a call that cost nothing.
    expect(costUsd).toBe(0);
    expect(priced).toBe(false);
    expect(getModelRates("claude-not-released-yet")).toBeNull();
  });

  it("prices the summarization and drafting models differently", () => {
    const usage = { ...NO_USAGE, inputTokens: 1_000_000 };
    expect(calculateCost("claude-fable-5", usage).costUsd).toBeGreaterThan(
      calculateCost("claude-opus-5", usage).costUsd,
    );
  });
});

describe("toTokenUsage", () => {
  it("reads the SDK's snake_case usage block", () => {
    expect(
      toTokenUsage({
        input_tokens: 10,
        output_tokens: 20,
        cache_creation_input_tokens: 30,
        cache_read_input_tokens: 40,
      }),
    ).toEqual({
      inputTokens: 10,
      outputTokens: 20,
      cacheCreationInputTokens: 30,
      cacheReadInputTokens: 40,
    });
  });

  it("defaults absent fields to zero instead of producing NaN costs", () => {
    expect(toTokenUsage({ input_tokens: 10 })).toEqual({ ...NO_USAGE, inputTokens: 10 });
    expect(calculateCost("claude-fable-5", toTokenUsage({ input_tokens: 10 })).costUsd).not.toBeNaN();
  });

  it("survives a missing usage block rather than throwing out of a finished run", () => {
    expect(toTokenUsage(undefined)).toEqual(NO_USAGE);
    expect(toTokenUsage(null)).toEqual(NO_USAGE);
  });
});
