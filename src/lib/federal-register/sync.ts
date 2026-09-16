import type { SupabaseClient } from "@supabase/supabase-js";
import { cleanFederalRegisterText } from "@/lib/federal-register/clean-text";
import { findUnlinkedLegacyRow, flagUnlinkedLegacyRow } from "@/lib/federal-register/find-unlinked-legacy";
import { checkDateSanity } from "@/lib/federal-register/date-sanity";
import { parseDispositionNotes } from "@/lib/federal-register/parse-disposition";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";

// Deterministic fields a Federal Register correction can change. Compared
// against a row's manually_edited_fields (camelCase ExecutiveOrder keys) to
// decide whether a correction is safe to apply automatically.
const CORRECTION_TOUCHES_FIELDS = ["title", "fullText", "citation", "sourceNotes", "status"] as const;

export interface ExecutiveOrderUpsertRecord {
  document_number: string;
  eo_number: string | null;
  action_type: string;
  title: string;
  federal_register_url: string;
  date_signed: string | null;
  date_published: string;
  status: "active" | "amended" | "revoked";
  citation: string | null;
  full_text: string;
  source_notes: string | null;
  federal_register_synced_at: string;
}

/** Pure transform: a fetched document + its fetched raw text -> the deterministic fields to store. Zero AI, zero I/O. */
export function buildRecordFromDocument(
  doc: FederalRegisterDocument,
  rawFullText: string,
): ExecutiveOrderUpsertRecord {
  const { status } = parseDispositionNotes(doc.disposition_notes ?? doc.executive_order_notes);
  return {
    document_number: doc.document_number,
    // "EO 14421", matching the format every legacy-imported row already
    // uses (see src/data/legacy-import/executive-orders.json) — storing
    // the API's bare digit string here would make this row invisible to
    // eoNumber-based duplicate detection and inconsistent with every
    // legacy row's display format.
    eo_number: doc.subtype === "Executive Order" && doc.executive_order_number ? `EO ${doc.executive_order_number}` : null,
    action_type: doc.subtype,
    title: doc.title,
    federal_register_url: doc.html_url,
    date_signed: doc.signing_date,
    date_published: doc.publication_date,
    status,
    citation: doc.citation,
    full_text: cleanFederalRegisterText(rawFullText),
    source_notes: doc.disposition_notes ?? doc.executive_order_notes,
    federal_register_synced_at: new Date().toISOString(),
  };
}

/** Extracts the document_number from a Federal Register API resource URL, e.g. ".../documents/2026-03829" -> "2026-03829". */
export function extractDocumentNumber(resourceUrl: string): string {
  const segments = resourceUrl.split("/").filter(Boolean);
  return segments[segments.length - 1];
}

interface ExistingRow {
  id: string;
  document_number: string;
  manually_edited_fields: string[];
  applied_correction_document_numbers: string[];
}

async function findRowForCorrectionTarget(
  supabase: SupabaseClient,
  originalDocumentNumber: string,
  eoNumberFallback: string | null,
): Promise<ExistingRow | null> {
  // Primary: the row this document_number is (or has previously merged).
  const { data: direct, error: directError } = await supabase
    .from("executive_orders")
    .select("id, document_number, manually_edited_fields, applied_correction_document_numbers")
    .or(
      `document_number.eq.${originalDocumentNumber},applied_correction_document_numbers.cs.{${originalDocumentNumber}}`,
    )
    .maybeSingle();
  if (directError) throw new Error(`Correction target lookup failed: ${directError.message}`);
  if (direct) return direct as ExistingRow;

  // Fallback for a multi-hop correction chain where the direct lookup above
  // somehow misses: eo_number is stable across every correction to an EO.
  // Only meaningful for true EOs with a document_number already set — never
  // matches an unreconciled legacy row (those have document_number null).
  // Uses limit(1) rather than maybeSingle(): eo_number is documented as NOT
  // guaranteed unique (known legacy duplicates), and maybeSingle() throws
  // if more than one row matches — this fallback should degrade gracefully
  // (best-effort), never crash the whole sync over a data-quality issue
  // it isn't responsible for resolving.
  if (!eoNumberFallback) return null;
  const { data: byEoNumber, error: eoError } = await supabase
    .from("executive_orders")
    .select("id, document_number, manually_edited_fields, applied_correction_document_numbers")
    .eq("eo_number", eoNumberFallback)
    .not("document_number", "is", null)
    .limit(1);
  if (eoError) throw new Error(`Correction target eo_number fallback lookup failed: ${eoError.message}`);
  return ((byEoNumber as ExistingRow[] | null) ?? [])[0] ?? null;
}

export type SyncAction = "inserted" | "updated" | "flagged" | "skipped_correction_target_missing" | "unchanged";

export interface SyncOutcome {
  documentNumber: string;
  action: SyncAction;
  detail?: string;
}

/**
 * Ingests one Federal Register document: inserts it if unseen, merges it
 * into the row it corrects if it's a correction (flagging for review
 * instead of overwriting a manually-edited field), or reports it as already
 * present. Shared by the backfill script, the daily ingest job, and
 * reconciliation's gap-fill step — the only difference between them is
 * which documents they call this with.
 */
export async function syncDocument(
  supabase: SupabaseClient,
  doc: FederalRegisterDocument,
  rawFullText: string,
): Promise<SyncOutcome> {
  const record = buildRecordFromDocument(doc, rawFullText);

  if (!doc.correction_of) {
    const { data: existing, error: lookupError } = await supabase
      .from("executive_orders")
      .select("id")
      .eq("document_number", doc.document_number)
      .maybeSingle();
    if (lookupError) throw new Error(`Lookup failed for ${doc.document_number}: ${lookupError.message}`);
    if (existing) {
      return { documentNumber: doc.document_number, action: "unchanged" };
    }

    // Before inserting a fresh row, check for a legacy row that is the same
    // instrument but has not been linked to a document_number yet (either
    // the backfill has not run, or it flagged this one as an ambiguous match
    // rather than confidently reconciling it — see
    // scripts/backfill-federal-register.ts). Blind-inserting here silently
    // duplicates that order; this guard is what makes ingest/reconcile safe
    // to run in any order relative to the one-time backfill.
    //
    // Matching on title-and-date as well as eo_number is not optional: the
    // eo_number-only version of this guard let 62 proclamations and memoranda
    // through, because those instruments carry no EO number at all.
    const unlinkedLegacyRow = await findUnlinkedLegacyRow(supabase, record, doc.document_number);
    if (unlinkedLegacyRow) {
      await flagUnlinkedLegacyRow(supabase, unlinkedLegacyRow, doc.document_number, record);
      return {
        documentNumber: doc.document_number,
        action: "flagged",
        detail: `unlinked legacy row (matched on ${unlinkedLegacyRow.matchedOn})`,
      };
    }

    const dateSanityReason = checkDateSanity(record);
    const insertRecord = dateSanityReason
      ? { ...record, needs_review: true, review_reason: dateSanityReason }
      : record;
    const { error: insertError } = await supabase.from("executive_orders").insert(insertRecord);
    if (insertError) throw new Error(`Insert failed for ${doc.document_number}: ${insertError.message}`);
    return { documentNumber: doc.document_number, action: "inserted" };
  }

  // This document is a correction to something we should already have.
  const originalDocumentNumber = extractDocumentNumber(doc.correction_of);
  const target = await findRowForCorrectionTarget(supabase, originalDocumentNumber, doc.executive_order_number);

  if (!target) {
    return {
      documentNumber: doc.document_number,
      action: "skipped_correction_target_missing",
      detail: `Correction for ${originalDocumentNumber} arrived before the original was ingested (or it couldn't be matched) — will retry next run.`,
    };
  }

  const manuallyEdited = new Set(target.manually_edited_fields ?? []);
  const conflicting = CORRECTION_TOUCHES_FIELDS.filter((field) => manuallyEdited.has(field));

  if (conflicting.length > 0) {
    const { error } = await supabase
      .from("executive_orders")
      .update({
        needs_review: true,
        review_reason: `Federal Register correction ${doc.document_number} would change ${conflicting.join(", ")}, which has already been manually edited — left unchanged pending review.`,
        // Still recorded even though the content wasn't applied — without
        // this, reconciliation's gap check would see doc.document_number
        // as unaccounted-for forever and re-flag the same correction on
        // every future run.
        applied_correction_document_numbers: [
          ...new Set([...(target.applied_correction_document_numbers ?? []), doc.document_number]),
        ],
      })
      .eq("id", target.id);
    if (error) throw new Error(`Failed to flag correction conflict for ${doc.document_number}: ${error.message}`);
    return { documentNumber: doc.document_number, action: "flagged", detail: conflicting.join(", ") };
  }

  // record.document_number is deliberately not applied here — the row
  // keeps its original document_number as its stable identity; the
  // correction's own number is tracked in applied_correction_document_numbers instead.
  const correctionDateSanityReason = checkDateSanity(record);
  const { error } = await supabase
    .from("executive_orders")
    .update({
      eo_number: record.eo_number,
      action_type: record.action_type,
      title: record.title,
      federal_register_url: record.federal_register_url,
      date_signed: record.date_signed,
      date_published: record.date_published,
      status: record.status,
      citation: record.citation,
      full_text: record.full_text,
      source_notes: record.source_notes,
      federal_register_synced_at: record.federal_register_synced_at,
      applied_correction_document_numbers: [
        ...new Set([...(target.applied_correction_document_numbers ?? []), doc.document_number]),
      ],
      ...(correctionDateSanityReason
        ? { needs_review: true, review_reason: correctionDateSanityReason }
        : {}),
    })
    .eq("id", target.id);
  if (error) throw new Error(`Failed to apply correction ${doc.document_number}: ${error.message}`);

  return { documentNumber: doc.document_number, action: "updated" };
}
