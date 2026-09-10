import type { SupabaseClient } from "@supabase/supabase-js";
import { checkDateSanity } from "@/lib/federal-register/date-sanity";
import { buildRecordFromDocument } from "@/lib/federal-register/sync";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";

// Identity gate: how similar a legacy row's title has to be to its
// eo_number-matched Federal Register document's title before we trust it's
// really the same order. Below this, we don't touch the row at all — we
// aren't confident it's even the right document.
export const MIN_TITLE_SIMILARITY = 0.3;

// No longer a gate (Federal Register is trusted for every deterministic
// field once identity is confirmed) — only decides whether a reconciled
// row's date needed correcting, so the "verify" flag can say so.
export const MAX_SIGNING_DATE_GAP_DAYS = 14;

export interface LegacyRow {
  id: string;
  eo_number: string;
  title: string;
  date_signed: string | null;
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

/** eo_numbers appearing on more than one row still awaiting reconciliation — these can never be safely auto-matched, no matter how the rest of this logic evolves. */
export function findDuplicateEoNumbers(rows: LegacyRow[]): Set<string> {
  const counts = new Map<string, number>();
  for (const row of rows) counts.set(row.eo_number, (counts.get(row.eo_number) ?? 0) + 1);
  return new Set([...counts.entries()].filter(([, count]) => count > 1).map(([eoNumber]) => eoNumber));
}

export type LegacyReconciliationOutcome =
  | "reconciled"
  | "reconciled_date_corrected"
  | "flagged_low_title_similarity"
  | "flagged_duplicate_eo_number"
  | "flagged_no_fr_match"
  | "flagged_document_linked_elsewhere";

export interface LegacyReconciliationPlanItem {
  rowId: string;
  eoNumber: string;
  legacyTitle: string;
  legacyDateSigned: string | null;
  outcome: LegacyReconciliationOutcome;
  matchedDocument: FederalRegisterDocument | null;
  /** Set whenever the row's needs_review/review_reason should be written; null means leave those columns alone. */
  reviewReason: string | null;
}

/**
 * Pure planning step: given the still-unlinked legacy rows and the fetched
 * Federal Register document list, decides what should happen to each row.
 * No I/O — the actual writes are a separate step (applyLegacyReconciliationPlan)
 * so this can run in a dry-run preview and be unit-tested without Supabase.
 *
 * Federal Register is the trusted source for every deterministic field
 * once eo_number + title identity is confirmed — the legacy row's own date
 * is corroborating evidence for that identity check, never a competing
 * value to preserve. A weak title match, a duplicate eo_number, or no
 * matching Federal Register document at all means identity itself is in
 * doubt, so those rows are flagged for a human, not auto-resolved.
 *
 * `existingDocumentNumbers` is every document_number already present on
 * some OTHER row (already-linked rows, not the unlinked ones being planned
 * here). A legacy row can be mislabeled such that its real Federal
 * Register document was already ingested as its own separate row by an
 * earlier run (back when this row's wrong number didn't match anything) —
 * writing the matched document onto this row too would violate the
 * table's unique document_number constraint. That's a duplicate-row
 * problem to merge by hand, not something to auto-apply or crash on.
 */
export function planLegacyReconciliation(
  rows: LegacyRow[],
  documents: FederalRegisterDocument[],
  existingDocumentNumbers: ReadonlySet<string> = new Set(),
): LegacyReconciliationPlanItem[] {
  const byEoNumberDigits = new Map(
    documents
      .filter((d) => d.subtype === "Executive Order" && !d.correction_of)
      .map((d) => [d.executive_order_number, d]),
  );
  const duplicateEoNumbers = findDuplicateEoNumbers(rows);

  return rows.map((row): LegacyReconciliationPlanItem => {
    const base = { rowId: row.id, eoNumber: row.eo_number, legacyTitle: row.title, legacyDateSigned: row.date_signed };

    if (duplicateEoNumbers.has(row.eo_number)) {
      return {
        ...base,
        outcome: "flagged_duplicate_eo_number",
        matchedDocument: null,
        reviewReason: `${row.eo_number} appears on more than one legacy row still awaiting reconciliation — resolve the duplicate or mistyped number by hand before this can auto-reconcile.`,
      };
    }

    const eoNumberDigits = row.eo_number.replace(/\D/g, "");
    const doc = byEoNumberDigits.get(eoNumberDigits);
    if (!doc) {
      return {
        ...base,
        outcome: "flagged_no_fr_match",
        matchedDocument: null,
        reviewReason: `No Federal Register Executive Order document found for ${row.eo_number} in the fetched administration-to-date range — verify the number is correct (it may be mistyped).`,
      };
    }

    const similarity = titleSimilarity(row.title, doc.title);
    if (similarity < MIN_TITLE_SIMILARITY) {
      return {
        ...base,
        outcome: "flagged_low_title_similarity",
        matchedDocument: doc,
        reviewReason: `Backfill matched ${row.eo_number} to Federal Register document ${doc.document_number} ("${doc.title}") by number, but the title doesn't line up confidently enough to auto-reconcile — needs manual review.`,
      };
    }

    if (existingDocumentNumbers.has(doc.document_number)) {
      return {
        ...base,
        outcome: "flagged_document_linked_elsewhere",
        matchedDocument: doc,
        reviewReason: `${row.eo_number} matches Federal Register document ${doc.document_number} ("${doc.title}"), but that document is already linked to a different row — likely inserted separately before this row's number was corrected. Merge the two rows by hand (carry this row's curated fields over, then delete it) rather than auto-reconciling.`,
      };
    }

    // Identity confirmed. Missing date on either side fails toward
    // "correction needed" (Infinity), never toward "dates agree" — an
    // absent date is missing corroborating evidence, not evidence of a match.
    const dateGapDays =
      row.date_signed && doc.signing_date ? daysBetween(row.date_signed, doc.signing_date) : Infinity;

    if (dateGapDays <= MAX_SIGNING_DATE_GAP_DAYS) {
      return { ...base, outcome: "reconciled", matchedDocument: doc, reviewReason: null };
    }

    return {
      ...base,
      outcome: "reconciled_date_corrected",
      matchedDocument: doc,
      reviewReason: `date_signed auto-corrected from the legacy value (${row.date_signed ?? "none"}) to Federal Register's ${doc.signing_date} for document ${doc.document_number} — verify.`,
    };
  });
}

export interface ApplyLegacyReconciliationResult {
  tally: Record<LegacyReconciliationOutcome, number>;
  /** One row's write failing (e.g. an unexpected constraint violation) never aborts the rest of the batch — matches the per-document try/catch pattern the ingest/reconcile jobs already use. */
  errors: string[];
}

/**
 * Applies a plan from planLegacyReconciliation. Reconciled rows get every
 * deterministic field from buildRecordFromDocument (Federal Register is
 * authoritative for those); flagged rows only get needs_review/review_reason
 * set — their other fields are left untouched since identity wasn't confirmed.
 */
export async function applyLegacyReconciliationPlan(
  supabase: SupabaseClient,
  plan: LegacyReconciliationPlanItem[],
  fetchRawText: (rawTextUrl: string) => Promise<string>,
): Promise<ApplyLegacyReconciliationResult> {
  const tally: Record<LegacyReconciliationOutcome, number> = {
    reconciled: 0,
    reconciled_date_corrected: 0,
    flagged_low_title_similarity: 0,
    flagged_duplicate_eo_number: 0,
    flagged_no_fr_match: 0,
    flagged_document_linked_elsewhere: 0,
  };
  const errors: string[] = [];

  for (const item of plan) {
    try {
      if (item.outcome === "reconciled" || item.outcome === "reconciled_date_corrected") {
        const doc = item.matchedDocument!;
        const rawText = await fetchRawText(doc.raw_text_url);
        const record = buildRecordFromDocument(doc, rawText);
        // Defense in depth: even Federal Register's own date could in
        // principle fail a sanity check (e.g. a future-dated document). Not
        // expected to fire alongside the date-correction reason above, but
        // combined rather than dropped if it ever does, rather than one
        // silently clobbering the other.
        const dateSanityReason = checkDateSanity(record);
        const combinedReason = [item.reviewReason, dateSanityReason].filter(Boolean).join(" Also: ") || null;
        // A clean reconcile clears any needs_review this row carried in
        // before it was linked (e.g. sync.ts's "isn't linked yet" flag from
        // the daily ingest job noticing this eo_number first) — that
        // condition is resolved by definition once we get here, so leaving
        // the old flag/reason in place would be stale and misleading.
        const update: Record<string, unknown> = {
          ...record,
          needs_review: Boolean(combinedReason),
          review_reason: combinedReason,
        };
        const { error } = await supabase.from("executive_orders").update(update).eq("id", item.rowId);
        if (error) throw new Error(`Failed to reconcile row ${item.rowId} (${item.eoNumber}): ${error.message}`);
      } else {
        const { error } = await supabase
          .from("executive_orders")
          .update({ needs_review: true, review_reason: item.reviewReason })
          .eq("id", item.rowId);
        if (error) throw new Error(`Failed to flag row ${item.rowId} (${item.eoNumber}): ${error.message}`);
      }
      tally[item.outcome]++;
    } catch (err) {
      errors.push(err instanceof Error ? err.message : String(err));
    }
  }

  return { tally, errors };
}

/** Every legacy-imported row not yet linked to a real Federal Register document. */
export async function fetchUnlinkedLegacyRows(supabase: SupabaseClient): Promise<LegacyRow[]> {
  const { data, error } = await supabase
    .from("executive_orders")
    .select("id, eo_number, title, date_signed")
    .is("document_number", null)
    .not("eo_number", "is", null);
  if (error) throw new Error(`Failed to load legacy rows: ${error.message}`);
  return (data ?? []) as LegacyRow[];
}

/** Every document_number already present on a linked row — used to detect a legacy row whose real document was already ingested separately (see planLegacyReconciliation's existingDocumentNumbers param). */
export async function fetchExistingDocumentNumbers(supabase: SupabaseClient): Promise<Set<string>> {
  const { data, error } = await supabase.from("executive_orders").select("document_number").not("document_number", "is", null);
  if (error) throw new Error(`Failed to load existing document_numbers: ${error.message}`);
  return new Set((data ?? []).map((row) => row.document_number as string));
}
