import type { SupabaseClient } from "@supabase/supabase-js";
import { checkHealth, type RunSummary } from "@/lib/alerts/check-health";
import { formatAlert } from "@/lib/alerts/format-alert";
import { sendSlackAlert, type FetchLike } from "@/lib/alerts/send-slack-alert";
import { MAX_RUN_AGE_HOURS } from "@/lib/alerts/thresholds";
import { applyEnrichQueueFilter } from "@/lib/federal-register/enrich-queue";
import { formatError } from "@/lib/format-error";

// Enough history to cover the longest staleness allowance (the weekly
// reconcile's week-plus) with room to spare, so the newest run of every
// type is always in the window.
const RUN_HISTORY_LIMIT = 50;

export interface WatchdogResult {
  problemCount: number;
  sent: boolean;
  deliveryDetail?: string;
  /** Present when the watchdog could not read the state it needs. */
  readError?: string;
}

export interface WatchdogDeps {
  now?: Date;
  fetchImpl?: FetchLike;
}

async function loadRuns(supabase: SupabaseClient): Promise<RunSummary[]> {
  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("run_type, status, started_at, new_count, updated_count, error_message")
    .order("started_at", { ascending: false })
    .limit(RUN_HISTORY_LIMIT);
  if (error) throw new Error(`Could not read ingestion_runs: ${error.message}`);
  return (data ?? []).map((row) => ({
    runType: row.run_type as RunSummary["runType"],
    status: row.status as RunSummary["status"],
    startedAt: row.started_at as string,
    newCount: (row.new_count as number | null) ?? 0,
    updatedCount: (row.updated_count as number | null) ?? 0,
    errorMessage: (row.error_message as string | null) ?? null,
  }));
}

async function loadEnrichQueueDepth(supabase: SupabaseClient): Promise<number> {
  // Same predicate the enrichment job selects by — see enrich-queue.ts for
  // why the two must not be allowed to drift apart.
  const { count, error } = await applyEnrichQueueFilter(
    supabase.from("executive_orders").select("id", { count: "exact", head: true }),
  );
  if (error) throw new Error(`Could not count the enrichment queue: ${error.message}`);
  return count ?? 0;
}

/**
 * Looks at the pipeline from outside and reports anything wrong to Slack.
 *
 * Deliberately writes nothing — not even a row recording that it ran. A
 * logged run would have to pass through startRun()'s overlap guard, which
 * means the one job whose purpose is noticing that other jobs are jammed
 * could itself become jammed. Its record is the message it sends, and its
 * own liveness is established by the weekly all-clear rather than by a row
 * somebody would have to go and read.
 *
 * `webhookUrl` and `siteUrl` are passed in rather than read from the
 * environment here, so the whole job is testable without touching
 * process.env (rule 3); the route resolves them through lib/alerts/config.
 *
 * A failure to READ the state is itself reported to Slack. That case used
 * to be the blind spot in every version of this idea: a watchdog that can
 * only speak when its database answers is silent exactly when the database
 * is the problem.
 */
export async function runWatchdogJob(
  supabase: SupabaseClient,
  { webhookUrl, siteUrl }: { webhookUrl: string; siteUrl: string },
  deps: WatchdogDeps = {},
): Promise<WatchdogResult> {
  const now = deps.now ?? new Date();

  let runs: RunSummary[];
  let enrichQueueDepth: number;
  try {
    [runs, enrichQueueDepth] = await Promise.all([loadRuns(supabase), loadEnrichQueueDepth(supabase)]);
  } catch (err) {
    const readError = formatError(err);
    const text = [
      ":rotating_light: *EO Tracker — the watchdog cannot see the database*",
      "",
      readError,
      "",
      "Nothing can be said about whether the nightly jobs ran, because the table that records them is unreadable.",
    ].join("\n");
    const delivery = await sendSlackAlert({ webhookUrl, text }, deps.fetchImpl);
    console.error(`Watchdog could not read state: ${readError}`);
    if (!delivery.delivered) {
      // Unreadable database AND an undeliverable alert. Without this the
      // dropped alarm left no trace at all — only the read error did.
      console.error(`Watchdog could not deliver the read-failure alert: ${delivery.detail}`);
    }
    return { problemCount: 1, sent: delivery.delivered, deliveryDetail: delivery.detail, readError };
  }

  const report = checkHealth({ now, runs, enrichQueueDepth });
  if (report.shouldStaySilent) {
    return { problemCount: 0, sent: false };
  }

  const delivery = await sendSlackAlert({ webhookUrl, text: formatAlert(report, siteUrl) }, deps.fetchImpl);
  if (!delivery.delivered) {
    // The alert exists and could not be delivered — the one failure this
    // system cannot announce through itself, so it must at least be loud in
    // the function's logs (rule 4).
    console.error(`Watchdog found ${report.problems.length} problem(s) but could not deliver: ${delivery.detail}`);
  }
  return { problemCount: report.problems.length, sent: delivery.delivered, deliveryDetail: delivery.detail };
}

// Re-exported so a caller can explain the thresholds without importing two
// modules; the values themselves live in thresholds.ts (rule 5).
export { MAX_RUN_AGE_HOURS };
