#!/usr/bin/env node
/**
 * Merges orders that were recorded twice — once from the firm's spreadsheet,
 * once from the Federal Register — into one row each.
 *
 * Usage:
 *   npm run merge:duplicates                  # dry run: prints every planned merge, changes nothing
 *   npm run merge:duplicates -- --apply       # does it
 *   npm run merge:duplicates -- --verbose     # dry run, plus every resolved field per pair
 *
 * The full plan is written to data/duplicate-merges.json BEFORE any database
 * write, on a dry run as well as a real one. That file is the recovery
 * record: it holds the Federal Register row's values verbatim, so a merge
 * that fails halfway can be finished by hand.
 *
 * See src/lib/merge/merge-rules.ts for which side wins each field, and why.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { findDuplicatePairs, type DuplicateScan, type OrderRow } from "../src/lib/merge/duplicate-pairs";
import { planMerge, type MergePlan } from "../src/lib/merge/merge-rules";
import { formatError } from "../src/lib/format-error";
import { getServiceRoleClient } from "../src/lib/supabase";

const PLAN_FILE = "data/duplicate-merges.json";
/** Recoverable from the Federal Register by document_number, and ~8KB a row — kept out of the committed record. */
const EXCLUDED_FROM_RECORD = "full_text";

function preview(value: unknown, width = 96): string {
  const text = Array.isArray(value) ? JSON.stringify(value) : String(value ?? "—");
  const collapsed = text.replace(/\s+/g, " ").trim();
  return collapsed.length > width ? `${collapsed.slice(0, width - 1)}…` : collapsed;
}

async function fetchAllOrders(supabase: SupabaseClient): Promise<OrderRow[]> {
  const { data, error } = await supabase.from("executive_orders").select("*");
  if (error) throw new Error(`Could not load executive_orders: ${error.message}`);
  if (!data) throw new Error("Could not load executive_orders: no rows returned.");
  return data as OrderRow[];
}

function reportScan(scan: DuplicateScan, plans: MergePlan[]): void {
  console.log(`Duplicate pairs found: ${plans.length}`);
  if (scan.undatedCount > 0) {
    console.log(`Rows skipped for having no signing date: ${scan.undatedCount}`);
  }
  if (scan.irregular.length > 0) {
    console.log(`\n⚠ ${scan.irregular.length} group(s) need a human — NOT merged by this run:`);
    for (const group of scan.irregular) {
      console.log(`  ${group.reason}`);
      for (const row of group.rows) {
        console.log(`    ${row.id}  doc=${row.document_number ?? "—"}  ${preview(row.title, 60)}`);
      }
    }
  }
}

function reportPlan(plan: MergePlan, index: number, verbose: boolean): void {
  console.log(`\n[${index + 1}] ${plan.title}`);
  console.log(`    signed ${plan.dateSigned}   keep ${plan.keepId}   delete ${plan.deleteId}`);
  console.log(`    fields changed on the surviving row: ${Object.keys(plan.updates).length}`);

  for (const conflict of plan.conflicts) {
    console.log(`    ⚖ ${conflict.field} — both sides had a value, they disagree`);
    console.log(`        winner (${conflict.source}): ${preview(conflict.value)}`);
    console.log(`        loser            : ${preview(conflict.losingValue)}`);
  }

  if (!verbose) return;
  for (const resolution of plan.resolutions) {
    if (resolution.source === "neither") continue;
    console.log(`    · ${resolution.field.padEnd(36)} ← ${resolution.source.padEnd(15)} ${preview(resolution.value, 60)}`);
  }
}

/** The plan, plus the Federal Register row verbatim, so a half-finished merge can be repaired by hand. */
async function writePlanFile(plans: MergePlan[], scan: DuplicateScan): Promise<void> {
  const record = {
    generatedAt: new Date().toISOString().slice(0, 10),
    summary: {
      pairs: plans.length,
      irregularGroups: scan.irregular.length,
      conflicts: plans.reduce((total, plan) => total + plan.conflicts.length, 0),
    },
    note:
      "Written before any database write. Each entry holds the Federal Register row's values " +
      `verbatim except ${EXCLUDED_FROM_RECORD}, which is re-fetchable from the Federal Register by document_number.`,
    merges: plans.map((plan) => {
      // Stripped here rather than in planMerge: the apply step must still
      // write full_text, only the committed record leaves it out.
      const recordedUpdates = { ...plan.updates };
      delete recordedUpdates[EXCLUDED_FROM_RECORD];
      return {
        keepId: plan.keepId,
        deleteId: plan.deleteId,
        title: plan.title,
        dateSigned: plan.dateSigned,
        updates: recordedUpdates,
        conflicts: plan.conflicts.map(({ field, source, value, losingValue }) => ({
          field,
          winner: source,
          value,
          losingValue,
        })),
      };
    }),
    irregular: scan.irregular,
  };
  await writeFile(PLAN_FILE, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  console.log(`\nPlan written to ${PLAN_FILE}`);
}

/**
 * Applies one merge in three steps, in this order for one specific reason:
 * `document_number` is `unique` (0001_init.sql:63), so it cannot sit on both
 * rows at once.
 *
 *   1. copy everything EXCEPT document_number onto the surviving row
 *   2. delete the Federal Register row, freeing its document_number
 *   3. write document_number onto the surviving row
 *
 * Deleting first would be one step shorter, but a failure at the next step
 * would have destroyed the Federal Register row's data. This way the worst
 * case is a fully merged row that is missing only its document_number —
 * nothing lost, and the post-run verification below names it.
 */
async function applyMerge(supabase: SupabaseClient, plan: MergePlan): Promise<void> {
  const { document_number: documentNumber, ...withoutDocumentNumber } = plan.updates;

  if (Object.keys(withoutDocumentNumber).length > 0) {
    const { error } = await supabase.from("executive_orders").update(withoutDocumentNumber).eq("id", plan.keepId);
    if (error) throw new Error(`step 1 (copy fields onto ${plan.keepId}) failed: ${error.message}`);
  }

  const { error: deleteError } = await supabase.from("executive_orders").delete().eq("id", plan.deleteId);
  if (deleteError) throw new Error(`step 2 (delete ${plan.deleteId}) failed: ${deleteError.message}`);

  if (documentNumber !== undefined) {
    const { error } = await supabase
      .from("executive_orders")
      .update({ document_number: documentNumber })
      .eq("id", plan.keepId);
    if (error) {
      throw new Error(
        `step 3 (set document_number ${documentNumber} on ${plan.keepId}) failed: ${error.message}. ` +
          `The row is merged but unlinked — set it by hand from ${PLAN_FILE}.`,
      );
    }
  }
}

/** Reads the merged rows back and confirms each one actually carries the document_number it was supposed to get. */
async function verifyApplied(supabase: SupabaseClient, plans: MergePlan[]): Promise<void> {
  const keepIds = plans.map((plan) => plan.keepId);
  const { data, error } = await supabase.from("executive_orders").select("id, document_number").in("id", keepIds);
  if (error) {
    console.error(`\n⚠ Could not verify the merged rows: ${error.message}. Check ${PLAN_FILE} against the database by hand.`);
    return;
  }

  const actual = new Map((data as { id: string; document_number: string | null }[]).map((row) => [row.id, row.document_number]));
  const wrong = plans.filter((plan) => {
    const expected = plan.updates.document_number;
    return expected !== undefined && actual.get(plan.keepId) !== expected;
  });

  if (wrong.length === 0) {
    console.log(`Verified: all ${plans.length} surviving rows carry their Federal Register document number.`);
    return;
  }
  console.error(`\n⚠ ${wrong.length} merged row(s) are missing their document_number — repair from ${PLAN_FILE}:`);
  for (const plan of wrong) console.error(`    ${plan.keepId}  expected ${plan.updates.document_number}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const verbose = args.includes("--verbose");

  const supabase = getServiceRoleClient();
  const rows = await fetchAllOrders(supabase);
  console.log(`Loaded ${rows.length} orders.\n`);

  const scan = findDuplicatePairs(rows);
  const plans = scan.pairs.map(planMerge);

  reportScan(scan, plans);
  plans.forEach((plan, index) => reportPlan(plan, index, verbose));

  const conflictCount = plans.reduce((total, plan) => total + plan.conflicts.length, 0);
  console.log(`\n${plans.length} pair(s), ${conflictCount} field conflict(s) resolved by the rules in merge-rules.ts.`);

  await writePlanFile(plans, scan);

  // A column FIELD_PREFERENCE says nothing about falls back to the legacy
  // side, which is a guess, not a rule. Refusing to apply is deliberate:
  // action_type was missing on the first run and would have kept a stale
  // "Pending Federal Register Publication" on 4 rows without saying so.
  const unlisted = [...new Set(plans.flatMap((plan) => plan.unlistedFields))].sort();
  if (unlisted.length > 0) {
    console.error(`\n⚠ No merge rule for: ${unlisted.join(", ")}`);
    console.error("  Add each to FIELD_PREFERENCE in src/lib/merge/merge-rules.ts before applying.");
    process.exitCode = 1;
    return;
  }

  if (plans.length === 0) {
    console.log("Nothing to merge.");
    return;
  }

  if (!apply) {
    console.log("\nDry run — nothing was written. Re-run with -- --apply to perform these merges.");
    return;
  }

  console.log(`\nApplying ${plans.length} merge(s)…`);
  let done = 0;
  for (const plan of plans) {
    try {
      await applyMerge(supabase, plan);
      done++;
    } catch (err) {
      // Stops rather than continuing: a failure here means an assumption
      // about the data was wrong, and the remaining 60-odd merges would
      // most likely fail the same way, one destructive step at a time.
      console.error(`\n✖ Stopped after ${done} successful merge(s).`);
      console.error(`  Failed on "${plan.title}": ${formatError(err)}`);
      process.exitCode = 1;
      return;
    }
  }

  console.log(`Merged ${done} pair(s).`);
  await verifyApplied(supabase, plans);
}

main().catch((err) => {
  console.error(formatError(err));
  process.exit(1);
});
