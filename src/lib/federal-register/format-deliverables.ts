import type { Deliverable } from "@/lib/federal-register/summarize";

/**
 * Renders structured deliverables into the one-line-per-obligation text the
 * tracker's `deliverable` column has always held.
 *
 * The shape mirrors how the firm wrote these by hand in the original
 * spreadsheet — "<party> to <action> (<deadline>)." with a bare "None." when
 * nothing is owed — so AI-written rows sit in the same column as the 332
 * curated ones without the table looking like two different trackers.
 */

export const NO_DELIVERABLES_TEXT = "None.";

function formatOne({ action, deadline, responsibleParty }: Deliverable): string {
  const sentence = `${responsibleParty} to ${action}`.replace(/\.$/, "");
  return `${sentence} (${deadline}).`;
}

export function formatDeliverables(deliverables: Deliverable[] | null): string {
  if (!deliverables || deliverables.length === 0) return NO_DELIVERABLES_TEXT;
  return deliverables.map(formatOne).join("\n");
}
