import type { SupabaseClient } from "@supabase/supabase-js";
import { calculateCost, type TokenUsage } from "@/lib/usage/pricing";

/** Which part of the app spent the money. Kept narrow so the ticker can group by it. */
export type UsageFeature = "summarize" | "draft" | "content";

export interface RecordUsageParams {
  feature: UsageFeature;
  model: string;
  usage: TokenUsage;
  /** The ingestion run this call belonged to, when there was one. */
  ingestionRunId?: string | null;
}

/**
 * Records one model call's token usage and cost.
 *
 * Deliberately non-fatal: metering must never be the reason a summarization
 * run dies. A failed write is logged with what it was trying to record, so
 * the loss is visible in the logs rather than silently making the ticker
 * under-report (rule 4) — but the caller carries on.
 */
export async function recordApiUsage(
  supabase: SupabaseClient,
  { feature, model, usage, ingestionRunId = null }: RecordUsageParams,
): Promise<void> {
  const { costUsd, priced } = calculateCost(model, usage);

  const { error } = await supabase.from("api_usage").insert({
    feature,
    model,
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
    cache_creation_input_tokens: usage.cacheCreationInputTokens,
    cache_read_input_tokens: usage.cacheReadInputTokens,
    cost_usd: costUsd,
    priced,
    ingestion_run_id: ingestionRunId,
  });

  if (error) {
    console.error(
      `Failed to record API usage (${feature}, ${model}, $${costUsd.toFixed(4)}) — the call happened but is missing from the spend total:`,
      error.message,
    );
  }
}
