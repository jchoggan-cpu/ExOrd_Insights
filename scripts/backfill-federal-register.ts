#!/usr/bin/env node
/**
 * One-time historical backfill: pulls every Executive Order, Proclamation,
 * and Memorandum from the Federal Register API from the administration's
 * start date through today, reconciles the legacy-imported EO rows against
 * it by eo_number, and ingests everything else.
 *
 * Usage:
 *   npm run backfill:federal-register            # dry run — prints the legacy-reconciliation plan, writes nothing
 *   npm run backfill:federal-register -- --apply  # writes the plan, then ingests the full document list
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * .env.local (same as scripts/import-to-supabase.ts).
 *
 * This is a LOCAL SCRIPT, not a Vercel Cron endpoint — Vercel serverless
 * functions have a duration limit this run can plausibly exceed given how
 * many documents and full-text fetches it does in one pass.
 *
 * Federal Register is the trusted source for every deterministic EO field
 * (title, dates, citation, full text, status) once a legacy row's eo_number
 * and title confirm it's the same order as a fetched document — the legacy
 * spreadsheet is a one-time source of curated commentary and an identity
 * check, never a competing value for those fields. See
 * src/lib/federal-register/reconcile-legacy.ts for the actual decision
 * logic (kept there, not here, so it can be unit-tested without Supabase).
 *
 * Safe to re-run: legacy reconciliation only ever updates a row that still
 * has a null document_number, and every other document goes through the
 * same insert-if-unseen / update-if-correction logic as the daily ingest
 * job (see src/lib/federal-register/sync.ts) — so nothing is duplicated if
 * this is run more than once.
 *
 * Deliberately bends CLAUDE.md's "one job per file" rule: this runs legacy
 * reconciliation AND general ingestion in one script rather than two,
 * because it's a one-time operational tool (not long-lived application
 * logic) and the two steps must run in this order against the same fetched
 * document list — splitting them would mean either fetching that list
 * twice or introducing a way to pass it between two script invocations,
 * both worse than one documented exception here.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { fetchAllDocuments, fetchRawText } from "../src/lib/federal-register/client";
import { ADMINISTRATION_START_DATE } from "../src/lib/federal-register/constants";
import {
  applyLegacyReconciliationPlan,
  fetchExistingDocumentNumbers,
  fetchUnlinkedLegacyRows,
  planLegacyReconciliation,
  type LegacyReconciliationPlanItem,
} from "../src/lib/federal-register/reconcile-legacy";
import { syncDocument } from "../src/lib/federal-register/sync";
import type { FederalRegisterDocument } from "../src/lib/federal-register/types";
import { getServiceRoleClient } from "../src/lib/supabase";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const APPLY = process.argv.includes("--apply");
const supabase = getServiceRoleClient(); // throws loudly if NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing

function printLegacyPlan(plan: LegacyReconciliationPlanItem[]) {
  console.log(`\nLegacy reconciliation plan (${plan.length} row(s) still unlinked):`);
  for (const item of plan) {
    console.log(`\n  ${item.eoNumber} (row ${item.rowId}) -> ${item.outcome}`);
    console.log(`    legacy title: "${item.legacyTitle}"`);
    console.log(`    legacy date:  ${item.legacyDateSigned ?? "(none)"}`);
    if (item.matchedDocument) {
      console.log(`    FR document:  ${item.matchedDocument.document_number}`);
      console.log(`    FR title:     "${item.matchedDocument.title}"`);
      console.log(`    FR date:      ${item.matchedDocument.signing_date ?? "(none)"}`);
    }
    if (item.reviewReason) console.log(`    review flag:  ${item.reviewReason}`);
  }
}

async function ingestAll(documents: FederalRegisterDocument[]) {
  let newCount = 0;
  let updatedCount = 0;
  let flaggedCount = 0;
  let skippedCount = 0;

  for (const doc of documents) {
    const outcome = await syncDocument(supabase, doc, () => fetchRawText(doc.raw_text_url));
    if (outcome.action === "inserted") newCount++;
    else if (outcome.action === "updated") updatedCount++;
    else if (outcome.action === "flagged") flaggedCount++;
    else if (outcome.action === "skipped_correction_target_missing") skippedCount++;
  }

  return { newCount, updatedCount, flaggedCount, skippedCount };
}

async function main() {
  console.log(
    `Backfilling ${SUPABASE_URL} from ${ADMINISTRATION_START_DATE} through today (${APPLY ? "APPLYING" : "DRY RUN — pass --apply to write"})...`,
  );
  console.log("Fetching the full document list once (reused for both steps below)...");
  const documents = await fetchAllDocuments({ publicationDateGte: ADMINISTRATION_START_DATE });
  console.log(`  Found ${documents.length} documents.`);

  console.log("Step 1/2: planning legacy-row reconciliation by eo_number...");
  const legacyRows = await fetchUnlinkedLegacyRows(supabase);
  const existingDocumentNumbers = await fetchExistingDocumentNumbers(supabase);
  const plan = planLegacyReconciliation(legacyRows, documents, existingDocumentNumbers);
  printLegacyPlan(plan);

  if (!APPLY) {
    console.log("\nDry run only — nothing was written, and step 2 (general ingestion) was not run. Re-run with --apply to write this plan and continue.");
    return;
  }

  const { tally, errors: legacyErrors } = await applyLegacyReconciliationPlan(supabase, plan, fetchRawText);
  console.log(
    `\n  Reconciled ${tally.reconciled}, date-corrected ${tally.reconciled_date_corrected}; flagged ${tally.flagged_low_title_similarity} (low title similarity), ${tally.flagged_duplicate_eo_number} (duplicate eo_number), ${tally.flagged_no_fr_match} (no Federal Register match), ${tally.flagged_document_linked_elsewhere} (document already linked to a different row).`,
  );
  if (legacyErrors.length > 0) {
    console.log(`  ${legacyErrors.length} row(s) failed and were skipped (rest of the batch still applied):`);
    for (const err of legacyErrors) console.log(`    ${err}`);
  }

  console.log(
    "\nStep 2/2: ingesting the full document list (new documents, corrections; reconciled rows are now unchanged)...",
  );
  const { newCount, updatedCount, flaggedCount, skippedCount } = await ingestAll(documents);
  console.log(
    `  Inserted ${newCount}, updated ${updatedCount} (corrections), flagged ${flaggedCount}, skipped ${skippedCount} (correction target not found).`,
  );

  console.log("\nDone. Check the Needs Attention page for anything flagged.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
