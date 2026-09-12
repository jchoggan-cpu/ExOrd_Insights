import type { SupabaseClient } from "@supabase/supabase-js";
import type { UsageFeature } from "@/lib/usage/record";

/**
 * Aggregates recorded calls into the per-day figures the /usage ticker shows.
 *
 * Grouped in TypeScript rather than SQL because Supabase's REST API has no
 * GROUP BY: doing it here keeps the whole thing in one readable place, and
 * the row counts involved (a few hundred calls a day at most) are nowhere
 * near needing a database-side rollup or a materialized view.
 */

export interface DailyUsage {
  /** UTC date, "YYYY-MM-DD" — the same basis the model provider bills on. */
  date: string;
  calls: number;
  costUsd: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadInputTokens: number;
  /** Calls whose model wasn't in the rate table, so costUsd understates the truth. */
  unpricedCalls: number;
  byFeature: Record<string, { calls: number; costUsd: number }>;
}

export interface UsageSummary {
  today: DailyUsage;
  /** Most recent day first, including today. */
  days: DailyUsage[];
  /** Total across the window requested — not all time. */
  windowCostUsd: number;
}

/** How far back the ticker looks by default. */
export const USAGE_WINDOW_DAYS = 30;

interface UsageRow {
  feature: string;
  model: string;
  input_tokens: number;
  output_tokens: number;
  cache_read_input_tokens: number;
  cost_usd: string | number;
  priced: boolean;
  created_at: string;
}

function emptyDay(date: string): DailyUsage {
  return {
    date,
    calls: 0,
    costUsd: 0,
    inputTokens: 0,
    outputTokens: 0,
    cacheReadInputTokens: 0,
    unpricedCalls: 0,
    byFeature: {},
  };
}

/** UTC, to match how the provider bills — a local-midnight boundary would disagree with the invoice. */
export function utcDateKey(iso: string | Date): string {
  return new Date(iso).toISOString().slice(0, 10);
}

export function summarizeUsageRows(rows: UsageRow[], today: string): UsageSummary {
  const byDate = new Map<string, DailyUsage>();

  for (const row of rows) {
    const date = utcDateKey(row.created_at);
    const day = byDate.get(date) ?? emptyDay(date);

    // numeric columns come back as strings from PostgREST to avoid float
    // drift — parse rather than trusting the driver to have given a number.
    const cost = typeof row.cost_usd === "string" ? Number.parseFloat(row.cost_usd) : row.cost_usd;

    day.calls += 1;
    day.costUsd += Number.isFinite(cost) ? cost : 0;
    day.inputTokens += row.input_tokens ?? 0;
    day.outputTokens += row.output_tokens ?? 0;
    day.cacheReadInputTokens += row.cache_read_input_tokens ?? 0;
    if (!row.priced) day.unpricedCalls += 1;

    const feature = day.byFeature[row.feature] ?? { calls: 0, costUsd: 0 };
    feature.calls += 1;
    feature.costUsd += Number.isFinite(cost) ? cost : 0;
    day.byFeature[row.feature] = feature;

    byDate.set(date, day);
  }

  const days = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1));

  return {
    // A day with no calls is a real answer ($0.00), not a missing one.
    today: byDate.get(today) ?? emptyDay(today),
    days,
    windowCostUsd: days.reduce((total, day) => total + day.costUsd, 0),
  };
}

export async function getUsageSummary(
  supabase: SupabaseClient,
  windowDays: number = USAGE_WINDOW_DAYS,
): Promise<UsageSummary> {
  const since = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from("api_usage")
    .select("feature, model, input_tokens, output_tokens, cache_read_input_tokens, cost_usd, priced, created_at")
    .gte("created_at", since)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`Failed to load API usage: ${error.message}`);

  return summarizeUsageRows((data ?? []) as UsageRow[], utcDateKey(new Date()));
}

export type { UsageFeature };
