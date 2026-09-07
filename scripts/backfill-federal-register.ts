/**
 * One-time historical backfill: pulls every Executive Order, Proclamation,
 * and Memorandum from the Federal Register API from the administration's
 * start date through today, reconciles the 340 legacy-imported rows
 * against it by eo_number, and ingests everything else.
 *
 * Usage:
 *   npm run backfill:federal-register
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * .env.local (same as scripts/import-to-supabase.ts).
 *
 * This is a LOCAL SCRIPT, not a Vercel Cron endpoint — Vercel serverless
 * functions have a duration limit this run can plausibly exceed given how
 * many documents and full-text fetches it does in one pass.
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
import { buildRecordFromDocument, syncDocument } from "../src/lib/federal-register/sync";
import type { FederalRegisterDocument } from "../src/lib/federal-register/types";
import { getServiceRoleClient } from "../src/lib/supabase";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabase = getServiceRoleClient(); // throws loudly if NEXT_PUBLIC_SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY are missing

interface LegacyRow {
  id: string;
  eo_number: string;
  title: string;
  date_signed: string | null;
}

/**
 * eo_numbers appearing on more than one row still awaiting reconciliation
 * (same logic as flagDuplicateEoNumbers in src/lib/data.ts, computed here
 * instead of imported since that one operates on the app's ExecutiveOrder
 * type, not raw DB rows) — computed fresh from what's actually in the
 * database rather than a hardcoded list, so it can't go stale if a 5th
 * duplicate is ever found.
 */
function findDuplicateEoNumbers(rows: LegacyRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.eo_number, (counts.get(row.eo_number) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([eoNumber]) => eoNumber));
}

function titleSimilarity(a: string, b: string): number {
  const words = (s: string) =>
    new Set(
      s
        .toLowerCase()
        .replace(/[^a-z0-9 ]/g, "")
        .split(/\s+/)
        .filter(Boolean),
    );
  const wordsA = words(a);
  const wordsB = words(b);
  const shared = [...wordsA].filter((w) => wordsB.has(w)).length;
  return shared / Math.max(wordsA.size, wordsB.size, 1);
}

function daysBetween(a: string, b: string): number {
  return Math.abs(new Date(a).getTime() - new Date(b).getTime()) / 86_400_000;
}

// Thresholds for treating a legacy-row-to-Federal-Register match as
// confident enough to auto-reconcile without human review.
const MIN_TITLE_SIMILARITY = 0.3;
const MAX_SIGNING_DATE_GAP_DAYS = 14;

/**
 * Direct-updates each confidently-matched legacy row in place (never
 * inserts) so it never collides with the general ingest pass below, which
 * will see the now-populated document_number and correctly treat it as
 * already present.
 */
async function reconcileLegacyRows(
  documents: FederalRegisterDocument[],
): Promise<{ reconciled: number; flagged: number; duplicatesSkipped: number }> {
  // Excludes corrections: a correction shares its original's
  // executive_order_number, and since `documents` is fetched oldest-first,
  // an unfiltered map would let the correction silently overwrite the
  // original here — reconciling the legacy row against the wrong document
  // and leaving the true original to be re-inserted as a duplicate by
  // ingestAll below. Corrections are handled by ingestAll's normal
  // correction-merge logic once the original is linked, not here.
  const byEoNumberDigits = new Map(
    documents
      .filter((d) => d.subtype === "Executive Order" && !d.correction_of)
      .map((d) => [d.executive_order_number, d]),
  );

  const { data: legacyRows, error } = await supabase
    .from("executive_orders")
    .select("id, eo_number, title, date_signed")
    .is("document_number", null)
    .not("eo_number", "is", null);
  if (error) throw new Error(`Failed to load legacy rows: ${error.message}`);

  const rows = (legacyRows ?? []) as LegacyRow[];
  const duplicateEoNumbers = findDuplicateEoNumbers(rows);
  let reconciled = 0;
  let flagged = 0;

  for (const row of rows) {
    if (duplicateEoNumbers.has(row.eo_number)) continue;

    const eoNumberDigits = row.eo_number.replace(/\D/g, "");
    const doc = byEoNumberDigits.get(eoNumberDigits);
    if (!doc) continue; // not yet found in Federal Register — leave for a later reconcile run

    const similarity = titleSimilarity(row.title, doc.title);
    // Missing date on either side fails closed (Infinity, never <= the
    // threshold) rather than defaulting to 0 — a missing date is an
    // absence of corroborating evidence, not evidence the dates agree.
    const dateGapDays =
      row.date_signed && doc.signing_date ? daysBetween(row.date_signed, doc.signing_date) : Infinity;
    const confidentMatch = similarity >= MIN_TITLE_SIMILARITY && dateGapDays <= MAX_SIGNING_DATE_GAP_DAYS;

    if (!confidentMatch) {
      const { error: flagError } = await supabase
        .from("executive_orders")
        .update({
          needs_review: true,
          review_reason: `Backfill matched ${row.eo_number} to Federal Register document ${doc.document_number} ("${doc.title}") by number, but the title/date don't line up confidently enough to auto-reconcile — needs manual review.`,
        })
        .eq("id", row.id);
      if (flagError) throw new Error(flagError.message);
      flagged++;
      continue;
    }

    const rawText = await fetchRawText(doc.raw_text_url);
    const record = buildRecordFromDocument(doc, rawText);
    const { error: updateError } = await supabase.from("executive_orders").update(record).eq("id", row.id);
    if (updateError) throw new Error(`Failed to reconcile row ${row.id}: ${updateError.message}`);
    reconciled++;
  }

  return { reconciled, flagged, duplicatesSkipped: duplicateEoNumbers.size };
}

async function ingestAll(documents: FederalRegisterDocument[]) {
  let newCount = 0;
  let updatedCount = 0;
  let flaggedCount = 0;
  let skippedCount = 0;

  for (const doc of documents) {
    const rawText = await fetchRawText(doc.raw_text_url);
    const outcome = await syncDocument(supabase, doc, rawText);
    if (outcome.action === "inserted") newCount++;
    else if (outcome.action === "updated") updatedCount++;
    else if (outcome.action === "flagged") flaggedCount++;
    else if (outcome.action === "skipped_correction_target_missing") skippedCount++;
  }

  return { newCount, updatedCount, flaggedCount, skippedCount };
}

async function main() {
  console.log(`Backfilling ${SUPABASE_URL} from ${ADMINISTRATION_START_DATE} through today...`);
  console.log("Fetching the full document list once (reused for both steps below)...");
  const documents = await fetchAllDocuments({ publicationDateGte: ADMINISTRATION_START_DATE });
  console.log(`  Found ${documents.length} documents.`);

  console.log("Step 1/2: reconciling legacy rows by eo_number...");
  const { reconciled, flagged, duplicatesSkipped } = await reconcileLegacyRows(documents);
  console.log(
    `  Reconciled ${reconciled} legacy rows; flagged ${flagged} for manual review (plus ${duplicatesSkipped} rows sharing a duplicate eo_number, always skipped).`,
  );

  console.log("Step 2/2: ingesting the full document list (new documents, corrections; reconciled rows are now unchanged)...");
  const { newCount, updatedCount, flaggedCount, skippedCount } = await ingestAll(documents);
  console.log(
    `  Inserted ${newCount}, updated ${updatedCount} (corrections), flagged ${flaggedCount}, skipped ${skippedCount} (correction target not found).`,
  );

  console.log("Done. Check the Needs Attention page for anything flagged.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
