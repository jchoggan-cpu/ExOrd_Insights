import type { SupabaseClient } from "@supabase/supabase-js";
import { formatError } from "@/lib/format-error";
import { fetchAllDocuments, fetchRawText } from "@/lib/federal-register/client";
import { INGEST_TRAILING_WINDOW_DAYS } from "@/lib/federal-register/constants";
import { finishRunSafely, startRun } from "@/lib/federal-register/ingestion-run";
import { resolveRunStatus } from "@/lib/federal-register/run-status";
import { syncDocument } from "@/lib/federal-register/sync";

function isoDateDaysAgo(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() - days);
  return date.toISOString().slice(0, 10);
}

export interface JobResult {
  runId: string;
  status: "success" | "partial" | "failure";
  newCount: number;
  updatedCount: number;
  flaggedCount: number;
  skippedCount: number;
  errorMessage?: string;
}

// Federal Register client calls this job needs, as an injectable dependency
// (rule 3) — defaults to the real network-calling client so every existing
// caller (the cron route) needs no change. Tests inject fakes instead.
export interface IngestJobDeps {
  fetchAllDocuments: typeof fetchAllDocuments;
  fetchRawText: typeof fetchRawText;
}

const defaultDeps: IngestJobDeps = { fetchAllDocuments, fetchRawText };

/**
 * Daily job: re-checks the trailing INGEST_TRAILING_WINDOW_DAYS window for
 * new or corrected documents. "New" is existence-based (an unseen
 * document_number), not date-based — the window just keeps each run's API
 * query cheap; it never decides what counts as captured. Gaps older than
 * the window are reconcile's job (reconcile-job.ts), not this one's.
 */
export async function runIngestJob(supabase: SupabaseClient, deps: IngestJobDeps = defaultDeps): Promise<JobResult> {
  const runId = await startRun(supabase, "federal_register");
  let newCount = 0;
  let updatedCount = 0;
  let flaggedCount = 0;
  let skippedCount = 0;
  // Declared out here, not inside the try, because the status resolved
  // after the try/catch needs to know how many documents the run actually
  // worked through — the difference between "one of forty failed" and
  // "all forty failed".
  let attemptedCount = 0;
  const errors: string[] = [];

  try {
    const documents = await deps.fetchAllDocuments({ publicationDateGte: isoDateDaysAgo(INGEST_TRAILING_WINDOW_DAYS) });
    attemptedCount = documents.length;

    for (const doc of documents) {
      try {
        // Passed as a fetch, not a result: syncDocument only calls it for
        // a document it is actually going to store, and on a normal night
        // every document in this window is already stored.
        const outcome = await syncDocument(supabase, doc, () => deps.fetchRawText(doc.raw_text_url));
        if (outcome.action === "inserted") newCount++;
        else if (outcome.action === "updated") updatedCount++;
        else if (outcome.action === "flagged") flaggedCount++;
        else if (outcome.action === "skipped_correction_target_missing") skippedCount++;
      } catch (err) {
        errors.push(`${doc.document_number}: ${formatError(err)}`);
      }
    }
  } catch (err) {
    // The list request itself failed — nothing below was attempted.
    const errorMessage = formatError(err);
    await finishRunSafely(supabase, runId, { status: "failure", newCount, updatedCount, errorMessage });
    return { runId, status: "failure", newCount, updatedCount, flaggedCount, skippedCount, errorMessage };
  }

  const status = resolveRunStatus({ attempted: attemptedCount, failed: errors.length });
  const errorMessage = errors.length > 0 ? errors.join("; ") : undefined;
  await finishRunSafely(supabase, runId, { status, newCount, updatedCount, errorMessage });

  return { runId, status, newCount, updatedCount, flaggedCount, skippedCount, errorMessage };
}
