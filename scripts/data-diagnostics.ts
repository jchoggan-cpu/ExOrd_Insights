#!/usr/bin/env node
/**
 * Post-run data-quality report: record counts per table, date-sanity
 * failures, duplicate eo_numbers, and needs_review counts broken down by
 * reason category. Run by hand after a real ingest/backfill/reconcile run
 * to sanity-check what landed — not itself a cron job.
 *
 * Usage: npm run diagnostics
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { buildDiagnosticsReport, type DiagnosticsRow } from "../src/lib/diagnostics/build-report";
import { getServiceRoleClient } from "../src/lib/supabase";

const supabase = getServiceRoleClient();

const TABLES = ["executive_orders", "ingestion_runs", "rescinded_prior_orders", "agency_actions"] as const;

async function countRows(table: string): Promise<number> {
  const { count, error } = await supabase.from(table).select("id", { count: "exact", head: true });
  if (error) throw new Error(`Failed to count ${table}: ${error.message}`);
  return count ?? 0;
}

async function main() {
  console.log("Record counts:");
  for (const table of TABLES) {
    console.log(`  ${table}: ${await countRows(table)}`);
  }

  const { data, error } = await supabase
    .from("executive_orders")
    .select("id, eo_number, title, date_signed, date_published, needs_review, review_reason");
  if (error) throw new Error(`Failed to load executive_orders: ${error.message}`);
  const rows = (data ?? []) as DiagnosticsRow[];

  const report = buildDiagnosticsReport(rows);

  console.log(`\nDate sanity failures: ${report.dateSanityFailures.length}`);
  for (const failure of report.dateSanityFailures) {
    console.log(`  ${failure.eoNumber ?? failure.id}: ${failure.reason}`);
  }

  console.log(`\nPrior-administration holdovers (informational, not errors): ${report.priorAdministrationHoldovers.length}`);
  for (const holdover of report.priorAdministrationHoldovers) {
    console.log(`  ${holdover.eoNumber ?? holdover.id}`);
  }

  console.log(`\nDuplicate eo_numbers: ${report.duplicateEoNumbers.length}`);
  for (const eoNumber of report.duplicateEoNumbers) console.log(`  ${eoNumber}`);

  console.log(`\nneeds_review: ${report.needsReviewTotal} of ${report.totalRows} executive_orders rows`);
  for (const [category, count] of Object.entries(report.needsReviewByCategory).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${category}: ${count}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
