import type { SupabaseClient } from "@supabase/supabase-js";
import { formatError } from "@/lib/format-error";
import { fetchAllDocuments, fetchDocumentDetail, fetchRawText, MINIMAL_FIELDS } from "@/lib/federal-register/client";
import { ADMINISTRATION_START_DATE } from "@/lib/federal-register/constants";
import { finishRun, startRun } from "@/lib/federal-register/ingestion-run";
import { syncDocument } from "@/lib/federal-register/sync";

export interface ReconcileJobResult {
  runId: string;
  status: "success" | "partial" | "failure";
  gapsFound: number;
  newCount: number;
  updatedCount: number;
  flaggedCount: number;
  skippedCount: number;
  errorMessage?: string;
}

/**
 * Weekly job: a cheap document_number-only diff against the API over the
 * FULL administration-to-date range (not just the daily job's trailing
 * window), so a gap older than 90 days doesn't silently persist forever.
 * Anything missing is fetched in full and ingested directly — logged as
 * its own run type so a completeness gap is never confused with an
 * ingestion failure.
 */
export async function runReconcileJob(supabase: SupabaseClient): Promise<ReconcileJobResult> {
  const runId = await startRun(supabase, "federal_register_reconciliation");

  try {
    const apiDocuments = await fetchAllDocuments({
      publicationDateGte: ADMINISTRATION_START_DATE,
      fields: MINIMAL_FIELDS,
    });

    const { data: existingRows, error } = await supabase
      .from("executive_orders")
      .select("document_number, applied_correction_document_numbers")
      .not("document_number", "is", null);
    if (error) throw new Error(`Failed to load existing document_numbers: ${error.message}`);

    // A correction's document_number is expected to appear in some row's
    // applied_correction_document_numbers, not as its own row — see sync.ts.
    const accountedFor = new Set<string>();
    for (const row of existingRows ?? []) {
      if (row.document_number) accountedFor.add(row.document_number as string);
      for (const corrected of (row.applied_correction_document_numbers as string[] | null) ?? []) {
        accountedFor.add(corrected);
      }
    }

    const missing = apiDocuments.filter((doc) => !accountedFor.has(doc.document_number));

    let newCount = 0;
    let updatedCount = 0;
    let flaggedCount = 0;
    let skippedCount = 0;
    const errors: string[] = [];

    for (const gap of missing) {
      try {
        const fullDoc = await fetchDocumentDetail(gap.document_number);
        const rawText = await fetchRawText(fullDoc.raw_text_url);
        const outcome = await syncDocument(supabase, fullDoc, rawText);
        if (outcome.action === "inserted") newCount++;
        else if (outcome.action === "updated") updatedCount++;
        else if (outcome.action === "flagged") flaggedCount++;
        else if (outcome.action === "skipped_correction_target_missing") skippedCount++;
      } catch (err) {
        errors.push(`${gap.document_number}: ${formatError(err)}`);
      }
    }

    const status = errors.length > 0 ? "partial" : "success";
    const errorMessage = errors.length > 0 ? errors.join("; ") : undefined;
    await finishRun(supabase, runId, { status, newCount, updatedCount, errorMessage });

    return {
      runId,
      status,
      gapsFound: missing.length,
      newCount,
      updatedCount,
      flaggedCount,
      skippedCount,
      errorMessage,
    };
  } catch (err) {
    const errorMessage = formatError(err);
    await finishRun(supabase, runId, { status: "failure", newCount: 0, updatedCount: 0, errorMessage });
    return {
      runId,
      status: "failure",
      gapsFound: 0,
      newCount: 0,
      updatedCount: 0,
      flaggedCount: 0,
      skippedCount: 0,
      errorMessage,
    };
  }
}
