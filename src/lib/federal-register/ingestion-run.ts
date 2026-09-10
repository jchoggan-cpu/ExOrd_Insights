import type { SupabaseClient } from "@supabase/supabase-js";
import { formatError } from "@/lib/format-error";
import { STALE_RUN_THRESHOLD_MINUTES } from "@/lib/federal-register/constants";

export type RunType = "federal_register" | "federal_register_reconciliation" | "federal_register_enrichment";
export type RunStatus = "success" | "partial" | "failure";

const MS_PER_MINUTE = 60_000;

/**
 * Starts a logged run, refusing to start a second one of the same type
 * while one is still marked "running" AND still fresh — a best-effort
 * guard against two overlapping cron invocations, not an airtight lock
 * (there's a small race window between the check and the insert,
 * acceptable given Vercel Cron doesn't fire the same schedule concurrently
 * in practice).
 *
 * A "running" row older than STALE_RUN_THRESHOLD_MINUTES is treated as
 * abandoned rather than in-flight — most likely a run whose own finishRun
 * write failed after doing its real work — and is marked "failed" as
 * superseded-by-stale so it stops jamming this guard (and the Needs
 * Attention report) for every run after it, forever. More than one
 * "running" row of the same type can exist at once (see the race window
 * noted above, or a platform timeout abandoning a run mid-flight); if even
 * one of them is still fresh the new run is refused, otherwise every one of
 * them — not just the first — is marked superseded before the new run starts.
 */
export async function startRun(supabase: SupabaseClient, runType: RunType): Promise<string> {
  // Selecting the plain array (rather than .maybeSingle()) matters here:
  // .maybeSingle() throws if more than one "running" row of this type ever
  // coexists — which is reachable (this function's own check-then-insert
  // race window below, or a platform timeout abandoning a run mid-flight)
  // — and that throw would jam the overlap guard permanently, defeating the
  // whole point of the staleness self-heal. An array select degrades
  // gracefully to any number of rows: 0, 1, or many.
  const { data: runningRows, error: checkError } = await supabase
    .from("ingestion_runs")
    .select("id, started_at")
    .eq("run_type", runType)
    .eq("status", "running");
  if (checkError) throw new Error(`Failed to check for an in-progress ${runType} run: ${checkError.message}`);

  const runningWithAge = (runningRows ?? []).map((row) => {
    const startedAt = row.started_at as string;
    return {
      id: row.id as string,
      startedAt,
      ageMinutes: (Date.now() - new Date(startedAt).getTime()) / MS_PER_MINUTE,
    };
  });

  const freshRun = runningWithAge.find((run) => run.ageMinutes < STALE_RUN_THRESHOLD_MINUTES);
  if (freshRun) {
    throw new Error(`A ${runType} run (id ${freshRun.id}) is already in progress — skipping to avoid overlap.`);
  }

  // None of the running rows are fresh, so every one of them is stale —
  // mark all of them superseded, not just the first, or a left-behind
  // sibling would re-jam this same guard on the very next invocation.
  for (const staleRun of runningWithAge) {
    try {
      await finishRun(supabase, staleRun.id, {
        status: "failure",
        newCount: 0,
        updatedCount: 0,
        errorMessage:
          `Superseded as stale: still "running" after more than ${STALE_RUN_THRESHOLD_MINUTES} minutes ` +
          `(started at ${staleRun.startedAt}) — most likely its own finishRun update failed.`,
      });
    } catch (err) {
      // Don't silently start a second run on top of a guard we couldn't
      // actually clear — if we can't even write the stale-supersession
      // marker, something is wrong with writes to ingestion_runs itself.
      throw new Error(
        `Found a stale ${runType} run (id ${staleRun.id}) but failed to mark it superseded: ${formatError(err)}`,
      );
    }
  }

  const { data, error } = await supabase
    .from("ingestion_runs")
    .insert({ run_type: runType, status: "running" })
    .select("id")
    .single();
  if (error || !data) throw new Error(`Failed to start ${runType} run: ${error?.message}`);
  return data.id as string;
}

export async function finishRun(
  supabase: SupabaseClient,
  runId: string,
  result: { status: RunStatus; newCount: number; updatedCount: number; errorMessage?: string },
): Promise<void> {
  const { error } = await supabase
    .from("ingestion_runs")
    .update({
      status: result.status,
      new_count: result.newCount,
      updated_count: result.updatedCount,
      error_message: result.errorMessage ?? null,
      finished_at: new Date().toISOString(),
    })
    .eq("id", runId);
  if (error) throw new Error(`Failed to finish run ${runId}: ${error.message}`);
}

/**
 * Same as finishRun, but never throws — logs and returns instead. Callers
 * (the three job orchestrators) use this for their own final bookkeeping
 * write so that a transient failure there doesn't also discard the job's
 * real result (newCount/updatedCount/errors) or crash the cron invocation.
 * Safe to swallow specifically because startRun's staleness check above
 * already self-heals whatever this leaves stuck at "running" — this is no
 * longer the last line of defense against jamming the overlap guard, just
 * the tidy path. The failure is still surfaced, via console.error, which
 * Vercel captures in the function's logs.
 */
export async function finishRunSafely(
  supabase: SupabaseClient,
  runId: string,
  result: { status: RunStatus; newCount: number; updatedCount: number; errorMessage?: string },
): Promise<void> {
  try {
    await finishRun(supabase, runId, result);
  } catch (err) {
    console.error(`Failed to record ${result.status} outcome for run ${runId}: ${formatError(err)}`);
  }
}
