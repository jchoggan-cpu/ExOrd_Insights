import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizeTitle } from "@/lib/normalize-title";

/**
 * Stopping ingestion from creating a second row for an order the firm
 * already recorded.
 *
 * A legacy spreadsheet row has no `document_number` until the backfill links
 * it to a Federal Register document. If ingestion meets that document before
 * the link exists, a blind insert silently duplicates the order — the row is
 * never wrong, just doubled, so nothing errors and nothing looks broken.
 *
 * This guard originally lived inline in sync.ts and only matched on
 * `eo_number`. That is precisely why it missed 62 duplicates: proclamations
 * and memoranda have no EO number, so the guard never ran for them at all
 * (see data/duplicate-merges.json and the 2026-09-16 merge). It now falls
 * back to title-plus-signing-date, which is what those 62 were eventually
 * matched on.
 *
 * Like the original, a match flags the legacy row rather than linking it.
 * Linking is the backfill's job and it applies its own confidence checks;
 * guessing here would risk fusing two records on a heuristic.
 */

/** How the legacy row was recognized — reported so a flagged row says which signal fired. */
export type LegacyMatchBasis = "eo_number" | "title_and_date";

export interface UnlinkedLegacyRow {
  id: string;
  needs_review: boolean;
  matchedOn: LegacyMatchBasis;
}

/** The fields of a would-be-inserted record this guard compares against. */
export interface IncomingRecord {
  eo_number: string | null;
  title: string;
  date_signed: string | null;
}

interface LegacyCandidate {
  id: string;
  title: string;
  needs_review: boolean;
}

async function findByEoNumber(
  supabase: SupabaseClient,
  eoNumber: string,
  documentNumber: string,
): Promise<UnlinkedLegacyRow | null> {
  // limit(1) rather than maybeSingle(): eo_number is documented as NOT
  // unique (see 0001_init.sql), and maybeSingle() throws on more than one.
  const { data, error } = await supabase
    .from("executive_orders")
    .select("id, needs_review")
    .eq("eo_number", eoNumber)
    .is("document_number", null)
    .limit(1);
  if (error) throw new Error(`Legacy-row lookup by eo_number failed for ${documentNumber}: ${error.message}`);

  const row = (data as Pick<LegacyCandidate, "id" | "needs_review">[] | null)?.[0];
  return row ? { id: row.id, needs_review: row.needs_review, matchedOn: "eo_number" } : null;
}

/**
 * Titles are compared in JavaScript rather than SQL because normalizeTitle
 * has no Postgres equivalent here. The query narrows to one signing date
 * first, which is a handful of rows — no index or expression index needed.
 */
async function findByTitleAndDate(
  supabase: SupabaseClient,
  record: IncomingRecord,
  documentNumber: string,
): Promise<UnlinkedLegacyRow | null> {
  if (!record.date_signed) return null;

  const { data, error } = await supabase
    .from("executive_orders")
    .select("id, title, needs_review")
    .eq("date_signed", record.date_signed)
    .is("document_number", null);
  if (error) throw new Error(`Legacy-row lookup by title failed for ${documentNumber}: ${error.message}`);

  const wanted = normalizeTitle(record.title);
  const match = (data as LegacyCandidate[] | null)?.find((row) => normalizeTitle(row.title) === wanted);
  return match ? { id: match.id, needs_review: match.needs_review, matchedOn: "title_and_date" } : null;
}

/**
 * Looks for an unlinked legacy row matching the incoming document, by EO
 * number first (the stronger signal) and title-plus-date second. Returns
 * null when the document is genuinely new and safe to insert.
 */
export async function findUnlinkedLegacyRow(
  supabase: SupabaseClient,
  record: IncomingRecord,
  documentNumber: string,
): Promise<UnlinkedLegacyRow | null> {
  if (record.eo_number) {
    const byEoNumber = await findByEoNumber(supabase, record.eo_number, documentNumber);
    if (byEoNumber) return byEoNumber;
  }
  return findByTitleAndDate(supabase, record, documentNumber);
}

function reasonFor(match: UnlinkedLegacyRow, documentNumber: string, record: IncomingRecord): string {
  const signal =
    match.matchedOn === "eo_number"
      ? `this row's eo_number (${record.eo_number})`
      : `this row's title and signing date (${record.date_signed})`;
  return (
    `Federal Register document ${documentNumber} matches ${signal} but isn't linked yet — ` +
    `run the backfill/reconciliation matching logic (or link manually) rather than treating this as a new order.`
  );
}

/**
 * Flags the matched legacy row so it surfaces in Needs Attention.
 *
 * A row already flagged is left alone: a prior pass (the backfill's own
 * title/date confidence check, say) may have recorded a more specific
 * reason, and overwriting it would lose the better explanation.
 */
export async function flagUnlinkedLegacyRow(
  supabase: SupabaseClient,
  match: UnlinkedLegacyRow,
  documentNumber: string,
  record: IncomingRecord,
): Promise<void> {
  if (match.needs_review) return;

  const { error } = await supabase
    .from("executive_orders")
    .update({ needs_review: true, review_reason: reasonFor(match, documentNumber, record) })
    .eq("id", match.id);
  if (error) {
    throw new Error(`Failed to flag unlinked legacy match for ${documentNumber}: ${error.message}`);
  }
}
