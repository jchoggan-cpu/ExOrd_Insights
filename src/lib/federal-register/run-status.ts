import type { RunStatus } from "@/lib/federal-register/ingestion-run";

/**
 * Decides the status a finished job records, from how many items it tried
 * and how many of those errored.
 *
 * The distinction that matters is "some failed" versus "every one failed".
 * All three jobs previously wrote `errors.length > 0 ? "partial" : "success"`,
 * which reported a run where every single item failed identically to one
 * where a single item failed — so a systematically broken run (a bad
 * credential, an API returning errors for everything) looked like a mostly
 * healthy one. Anything watching these statuses to decide whether to raise
 * an alert would inherit that blind spot, so it is fixed here, in one place,
 * rather than in three near-identical expressions.
 *
 * Attempting nothing is a success, not a vacuous failure: an ingest run that
 * found no new documents, or an enrichment run with an empty queue, did
 * exactly what it was asked to. Note what that means for anything reading
 * these statuses as a health signal — a "success" carrying attempted === 0
 * proves the job ran, and nothing whatsoever about the work it would have
 * done. The enrichment queue being empty is precisely that case today.
 */
export function resolveRunStatus({ attempted, failed }: { attempted: number; failed: number }): RunStatus {
  if (failed > attempted) {
    // Unreachable if the caller derives both counts from the same loop, but
    // this codebase's bugs have a habit of being the unreachable ones. Don't
    // throw — this runs after the job's own try/catch has closed, so a throw
    // here would escape past finishRun and strand the run at "running" —
    // just say so loudly and take the conservative branch below.
    console.error(`resolveRunStatus received more failures (${failed}) than attempts (${attempted}).`);
  }
  if (attempted === 0 || failed === 0) return "success";
  return failed >= attempted ? "failure" : "partial";
}
