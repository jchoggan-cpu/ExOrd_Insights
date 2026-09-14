#!/usr/bin/env node
/**
 * Snapshots the firm's own hand-written executive-order summaries to a
 * version-controlled file, so they can never be lost.
 *
 * Usage:
 *   npm run snapshot:summaries                     # writes data/original-summaries-snapshot.json
 *   npm run snapshot:summaries -- --out path.json  # writes somewhere else instead
 *
 * Why this exists: 338 of the tracker's 614 summaries are the firm's own
 * curated text (marked by "aiSummary" in manually_edited_fields, which is
 * what protects them from being overwritten by the enrichment pipeline —
 * see CORRECTABLE_FIELDS in src/lib/corrections/correction-record.ts). None
 * of them has ever been verified against source text, and before anyone
 * considers regenerating or auditing them, they need to exist somewhere
 * safer than one `ai_summary` column. This script is that safety step.
 *
 * READ-ONLY: this never writes to the database, only to the output file.
 * There is deliberately no --apply flag — reading Supabase and writing a
 * local file is the entire job, every time it runs.
 *
 * full_text is deliberately not included in the snapshot: 116 of these rows
 * have none (so they can never be automatically fact-checked against
 * source — see the report this script prints), and for the rows that do
 * have it, the source text is large enough that including it in every
 * snapshot would bloat the file for no benefit — the snapshot is here to
 * preserve the firm's summary, not to duplicate the underlying instrument.
 * A per-row `hasFullText` boolean records the fact without the bulk.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getServiceRoleClient } from "../src/lib/supabase";

const DEFAULT_OUT_FILE = "data/original-summaries-snapshot.json";

/**
 * The marker that protects a summary from the enrichment pipeline —
 * see CORRECTABLE_FIELDS.aiSummary in src/lib/corrections/correction-record.ts.
 * A row carrying this in manually_edited_fields is firm-authored text, not
 * model output.
 */
const CURATED_SUMMARY_MARKER = "aiSummary";

interface CuratedRow {
  id: string;
  eo_number: string | null;
  title: string;
  date_signed: string | null;
  ai_summary: string | null;
  manually_edited_fields: string[];
  full_text: string | null;
}

export interface SnapshottedSummary {
  id: string;
  eoNumber: string | null;
  title: string;
  dateSigned: string | null;
  aiSummary: string | null;
  manuallyEditedFields: string[];
  /** Whether full_text exists for this row — the text itself is not stored here. */
  hasFullText: boolean;
}

function stringFlag(args: string[], flag: string, fallback: string): string {
  const at = args.indexOf(flag);
  if (at === -1) return fallback;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) {
    throw new Error(`${flag} needs a value.`);
  }
  return value;
}

/**
 * Loads every row whose summary is firm-curated. Filtered in Postgres via
 * array containment (`manually_edited_fields @> {aiSummary}`) rather than
 * fetched-then-filtered in JS, so what "counts" is answered by the same
 * mechanism that protects the column from being overwritten, not a
 * re-implementation of it here.
 */
async function fetchCuratedRows(supabase: SupabaseClient): Promise<CuratedRow[]> {
  const { data, error } = await supabase
    .from("executive_orders")
    .select("id, eo_number, title, date_signed, ai_summary, manually_edited_fields, full_text")
    .contains("manually_edited_fields", [CURATED_SUMMARY_MARKER])
    .order("date_signed", { ascending: true });
  if (error) throw new Error(`Failed to load curated summaries: ${error.message}`);
  return (data ?? []) as CuratedRow[];
}

function toSnapshot(row: CuratedRow): SnapshottedSummary {
  return {
    id: row.id,
    eoNumber: row.eo_number,
    title: row.title,
    dateSigned: row.date_signed,
    aiSummary: row.ai_summary,
    manuallyEditedFields: row.manually_edited_fields ?? [],
    hasFullText: row.full_text !== null && row.full_text !== "",
  };
}

async function main() {
  const args = process.argv.slice(2);
  const outFile = stringFlag(args, "--out", DEFAULT_OUT_FILE);

  const supabase = getServiceRoleClient();
  const rows = await fetchCuratedRows(supabase);
  const summaries = rows.map(toSnapshot);

  const withFullText = summaries.filter((s) => s.hasFullText).length;
  const withoutFullText = summaries.length - withFullText;

  const body = {
    takenAt: new Date().toISOString(),
    counts: {
      total: summaries.length,
      withFullText,
      withoutFullText,
    },
    summaries,
  };

  await writeFile(outFile, `${JSON.stringify(body, null, 2)}\n`, "utf8");

  console.log(`Firm-curated summaries found: ${summaries.length}`);
  console.log(`  with full_text (can be fact-checked later):    ${withFullText}`);
  console.log(`  without full_text (can never be fact-checked): ${withoutFullText}`);
  console.log(`\nSnapshot written to ${outFile}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
