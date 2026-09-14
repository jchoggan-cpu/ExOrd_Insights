#!/usr/bin/env node
/**
 * Corrects one field of one executive order, and writes down that it
 * happened.
 *
 * Usage:
 *   npm run correct -- --eo "EO 14183" --field aiSummary --reason "..."            # dry run
 *   npm run correct -- --eo "EO 14183" --field aiSummary --reason "..." --apply    # does it
 *
 * By default the field is cleared (set to null), which also removes its entry
 * from manually_edited_fields so the normal enrichment pipeline regenerates
 * it. Pass --value "text" to set a specific value instead.
 *
 * Every correction appends to data/data-corrections.json, committed to the
 * repo: what changed, why, and the previous value verbatim so it can be put
 * back. Past corrections were made directly against the live database with
 * no record at all, which is what this exists to stop.
 *
 * Deliberately one record at a time. A tool that could rewrite a whole
 * column by accident is not what this problem needs.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { readFile, writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildCorrectionRecord,
  buildCorrectionUpdate,
  CORRECTABLE_FIELDS,
  isCorrectableField,
  type CorrectableField,
  type CorrectionRecord,
} from "../src/lib/corrections/correction-record";
import { getServiceRoleClient } from "../src/lib/supabase";

const CORRECTIONS_FILE = "data/data-corrections.json";

function stringFlag(args: string[], flag: string): string | null {
  const at = args.indexOf(flag);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value.`);
  }
  return value;
}

async function loadCorrections(): Promise<CorrectionRecord[]> {
  let raw: string;
  try {
    raw = await readFile(CORRECTIONS_FILE, "utf8");
  } catch (cause) {
    // No log yet is normal before the first correction. Anything else is
    // reported rather than silently starting a fresh log, which would lose
    // the existing history.
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return [];
    throw new Error(`Could not read ${CORRECTIONS_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }
  const parsed: { corrections?: CorrectionRecord[] } = JSON.parse(raw);
  return parsed.corrections ?? [];
}

interface SubjectRow {
  id: string;
  eo_number: string | null;
  title: string;
  manually_edited_fields: string[];
  [column: string]: unknown;
}

async function fetchSubject(supabase: SupabaseClient, eoNumber: string, column: string): Promise<SubjectRow> {
  const { data, error } = await supabase
    .from("executive_orders")
    .select(`id, eo_number, title, manually_edited_fields, ${column}`)
    .eq("eo_number", eoNumber);
  if (error) throw new Error(`Failed to load ${eoNumber}: ${error.message}`);

  const rows = (data ?? []) as unknown as SubjectRow[];
  if (rows.length === 0) throw new Error(`No executive order found with eo_number "${eoNumber}".`);
  // Duplicate eo_numbers are a known issue in this data, so correcting one
  // by number would be ambiguous — refuse rather than pick arbitrarily.
  if (rows.length > 1) {
    throw new Error(`${rows.length} rows share eo_number "${eoNumber}". Correct them by id instead of by number.`);
  }
  return rows[0];
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const eoNumber = stringFlag(args, "--eo");
  const fieldName = stringFlag(args, "--field");
  const reason = stringFlag(args, "--reason");
  const value = stringFlag(args, "--value");

  if (!eoNumber || !fieldName || !reason) {
    throw new Error('Need --eo "EO 14183" --field aiSummary --reason "why this is wrong".');
  }
  if (!isCorrectableField(fieldName)) {
    throw new Error(`--field must be one of: ${Object.keys(CORRECTABLE_FIELDS).join(", ")}`);
  }

  const field: CorrectableField = fieldName;
  const column = CORRECTABLE_FIELDS[field];
  const supabase = getServiceRoleClient();
  const row = await fetchSubject(supabase, eoNumber, column);

  const subject = {
    id: row.id,
    eoNumber: row.eo_number,
    title: row.title,
    manuallyEditedFields: row.manually_edited_fields ?? [],
  };
  const before = row[column];
  const after = value ?? null;

  const record = buildCorrectionRecord({
    subject,
    field,
    reason,
    before,
    after,
    today: new Date().toISOString().slice(0, 10),
  });

  console.log(`${record.eoNumber ?? "(no number)"} — ${record.eoTitle}`);
  console.log(`field: ${field} (column ${column})`);
  console.log(`\nBEFORE:\n  ${JSON.stringify(before)}`);
  console.log(`\nAFTER:\n  ${JSON.stringify(after)}${after === null ? "  (cleared — the pipeline will regenerate it)" : ""}`);
  console.log(`\nprotection removed from manually_edited_fields: ${record.protectionRemoved}`);
  console.log(`reason: ${record.reason}`);

  if (!apply) {
    console.log(`\nDry run — nothing written. Re-run with --apply.`);
    return;
  }

  // The log is written before the database changes, so an interrupted run
  // can never leave a changed record with no record of the change.
  const corrections = [...(await loadCorrections()), record];
  await writeFile(CORRECTIONS_FILE, `${JSON.stringify({ corrections }, null, 2)}\n`, "utf8");

  const { error } = await supabase
    .from("executive_orders")
    .update(buildCorrectionUpdate({ subject, field, after }))
    .eq("id", subject.id);
  if (error) throw new Error(`Failed to update ${subject.eoNumber ?? subject.id}: ${error.message}`);

  console.log(`\nApplied, and logged to ${CORRECTIONS_FILE} (${corrections.length} correction(s) on record).`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
