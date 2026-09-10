import { ADMINISTRATION_START_DATE } from "@/lib/federal-register/constants";

/**
 * A prior-administration holdover: a document actually signed before this
 * administration's start date. buildQuery (see client.ts) filters ingestion
 * on date_published, never date_signed, so a handful of outgoing-
 * administration documents that happened to publish late legitimately land
 * in this tracker (EO numbering runs sequentially across administrations
 * and doesn't reset at inauguration, so the numbers alone look in-range).
 * Derived at read time — no stored flag, so it needs no migration and
 * automatically covers any future such row.
 */
export function isPriorAdministrationHoldover(dateSigned: string | null | undefined): boolean {
  return dateSigned != null && dateSigned < ADMINISTRATION_START_DATE;
}
