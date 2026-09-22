import type { SupabaseClient } from "@supabase/supabase-js";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";
import { parseDispositionNotes } from "@/lib/federal-register/parse-disposition";
import type { SyncOutcome } from "@/lib/federal-register/sync";

export interface ExistingStatusRow {
  id: string;
  status: "active" | "amended" | "revoked";
  manually_edited_fields: string[] | null;
}

/**
 * Re-reads an already-stored document's disposition and updates its status
 * if the Federal Register now says something different.
 *
 * This is the whole reason a document already in the database is worth
 * looking at again. Disposition notes are written onto a document AFTER
 * publication: an order is ingested as active, and months later a new order
 * revokes it and "Revoked by: EO 14244" appears on the original's notes.
 * Returning "unchanged" the moment the document_number matched meant that
 * line was never read, so an order stayed active in a law firm's tracker
 * after it had been revoked.
 *
 * Only the status moves. Everything else about a published document is
 * fixed, and re-writing title or text here would undo an attorney's edits.
 */
export async function refreshStatusOnly(
  supabase: SupabaseClient,
  doc: FederalRegisterDocument,
  existing: ExistingStatusRow,
): Promise<SyncOutcome> {
  const { status } = parseDispositionNotes(doc.disposition_notes ?? doc.executive_order_notes);

  if (status === existing.status) {
    return { documentNumber: doc.document_number, action: "unchanged" };
  }

  // A status someone set by hand outranks the Federal Register's. Flagging
  // rather than overwriting matches how a correction to any other
  // manually-edited field is handled.
  if (existing.manually_edited_fields?.includes("status")) {
    return {
      documentNumber: doc.document_number,
      action: "flagged",
      detail: `status is manually edited (${existing.status}); API now says ${status}`,
    };
  }

  // Captured before the update, not read back after it. The row object a
  // client hands back may be the very object the update mutates, in which
  // case "active -> revoked" would report itself as "revoked -> revoked".
  const previousStatus = existing.status;

  const { error } = await supabase
    .from("executive_orders")
    .update({
      status,
      source_notes: doc.disposition_notes ?? doc.executive_order_notes,
      federal_register_synced_at: new Date().toISOString(),
    })
    .eq("id", existing.id);
  if (error) {
    throw new Error(`Status refresh failed for ${doc.document_number}: ${error.message}`);
  }

  return {
    documentNumber: doc.document_number,
    action: "updated",
    detail: `status ${previousStatus} -> ${status}`,
  };
}
