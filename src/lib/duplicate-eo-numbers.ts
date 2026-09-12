import type { SupabaseClient } from "@supabase/supabase-js";
import type { ExecutiveOrder } from "@/lib/types";

/**
 * Flagging orders that share an EO number — a data-quality problem inherited
 * from the source spreadsheet (see README "Known data quality issues").
 *
 * Split out of executive-orders.ts, which had reached the project's 300-line
 * ceiling and was carrying two jobs (fetching orders, and this). Keeping it
 * here also makes the pagination hazard obvious: `flagDuplicateEoNumbers`
 * can only see the rows it is handed, so once the tracker stops loading
 * every row it stops being a whole-table check. `countRowsSharingEoNumber`
 * is the paged-safe form — it asks the database, so it is unaffected by how
 * many rows the caller happens to be showing.
 */

export function duplicateEoNumberReason(eoNumber: string): string {
  return `${eoNumber} appears on more than one record in the source data — likely a data-entry error in the original tracker. Verify against the Federal Register before relying on this number.`;
}

/**
 * Flags any order whose eoNumber is shared with another order IN THE LIST
 * PASSED IN. Computed fresh on every fetch rather than stored, so it
 * self-corrects once the underlying duplicates are reconciled. Generic so it
 * works on full ExecutiveOrder rows and list-shaped rows alike.
 *
 * Only correct when `orders` is the complete set. For one page of a paged
 * query, use `flagDuplicatesFromCounts` with counts from the database.
 */
export function flagDuplicateEoNumbers<
  T extends { eoNumber?: string; needsReview?: boolean; needsReviewReason?: string },
>(orders: T[]): T[] {
  const counts = new Map<string, number>();
  for (const eo of orders) {
    if (eo.eoNumber) counts.set(eo.eoNumber, (counts.get(eo.eoNumber) ?? 0) + 1);
  }
  return flagDuplicatesFromCounts(orders, counts);
}

/**
 * Flags orders using counts computed elsewhere — the paged-safe half. The
 * caller supplies how many rows in the WHOLE table share each EO number, so
 * two duplicates that land on different pages are still both flagged.
 */
export function flagDuplicatesFromCounts<
  T extends { eoNumber?: string; needsReview?: boolean; needsReviewReason?: string },
>(orders: T[], counts: Map<string, number>): T[] {
  return orders.map((eo) => {
    if (eo.eoNumber && (counts.get(eo.eoNumber) ?? 0) > 1) {
      return { ...eo, needsReview: true, needsReviewReason: duplicateEoNumberReason(eo.eoNumber) };
    }
    return eo;
  });
}

/**
 * Counts, for each EO number given, how many rows in the table carry it.
 * One query for the whole page rather than one per row.
 *
 * Fails open (an empty map, so nothing is flagged) but never silently: a
 * broken secondary check must not stop the tracker rendering, and must not
 * make a real duplicate read as clean without a trace.
 */
export async function countRowsSharingEoNumbers(
  supabase: SupabaseClient,
  eoNumbers: string[],
): Promise<Map<string, number>> {
  const wanted = [...new Set(eoNumbers.filter(Boolean))];
  if (wanted.length === 0) return new Map();

  const { data, error } = await supabase
    .from("executive_orders")
    .select("eo_number")
    .in("eo_number", wanted);

  if (error || !data) {
    console.error("Duplicate eo_number check failed; showing these orders unflagged:", error);
    return new Map();
  }

  const counts = new Map<string, number>();
  for (const row of data) {
    const value = row.eo_number as string | null;
    if (value) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return counts;
}

/**
 * Re-checks a single detail row against every other row sharing its
 * eoNumber, since getExecutiveOrderById only fetches the one row and can't
 * reproduce the cross-row comparison itself.
 */
export async function applyDuplicateFlag(
  supabase: SupabaseClient,
  eo: ExecutiveOrder,
): Promise<ExecutiveOrder> {
  if (!eo.eoNumber) return eo;

  const counts = await countRowsSharingEoNumbers(supabase, [eo.eoNumber]);
  if ((counts.get(eo.eoNumber) ?? 0) > 1) {
    return { ...eo, needsReview: true, needsReviewReason: duplicateEoNumberReason(eo.eoNumber) };
  }
  return eo;
}
