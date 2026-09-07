import type { SupabaseClient } from "@supabase/supabase-js";

export type RunType = "federal_register" | "federal_register_reconciliation" | "federal_register_enrichment";
export type RunStatus = "success" | "partial" | "failure";

/**
 * Starts a logged run, refusing to start a second one of the same type
 * while one is still marked "running" — a best-effort guard against two
 * overlapping cron invocations, not an airtight lock (there's a small race
 * window between the check and the insert, acceptable given Vercel Cron
 * doesn't fire the same schedule concurrently in practice).
 */
export async function startRun(supabase: SupabaseClient, runType: RunType): Promise<string> {
  const { data: alreadyRunning, error: checkError } = await supabase
    .from("ingestion_runs")
    .select("id")
    .eq("run_type", runType)
    .eq("status", "running")
    .maybeSingle();
  if (checkError) throw new Error(`Failed to check for an in-progress ${runType} run: ${checkError.message}`);
  if (alreadyRunning) {
    throw new Error(`A ${runType} run (id ${alreadyRunning.id}) is already in progress — skipping to avoid overlap.`);
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
