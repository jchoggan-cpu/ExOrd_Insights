import { getExecutiveOrders } from "@/lib/executive-orders";
import { parentPracticeOf } from "@/lib/taxonomy";
import type { ExecutiveOrderListItem } from "@/lib/types";
import { offsetFor, totalPagesFor, type TrackerQuery } from "@/lib/tracker-query";

/**
 * The tracker's search, run in memory against the bundled legacy data — the
 * fallback for local development before Supabase is configured.
 *
 * Deliberately NOT a reimplementation of the Postgres behavior. It does a
 * plain case-insensitive substring match:
 *
 *   - no Boolean operators (`tariff OR duty` is searched literally)
 *   - no word stemming (`tariffs` will not find `tariff`)
 *   - no order body text (the legacy dataset has no full_text at all)
 *   - no relevance ranking, so the sort control only affects date order
 *
 * Reproducing websearch_to_tsquery in TypeScript would be a second search
 * engine to keep in step with the first, and the two would drift. A
 * developer running without a database gets something usable; the real
 * behavior is what runs against Postgres.
 */

interface TrackerResultPage {
  rows: ExecutiveOrderListItem[];
  total: number;
  page: number;
  totalPages: number;
}

/**
 * True when the row carries any of the selected tags, counting a selected
 * parent as a match for its subgroups — the same rule migration 0008 applies
 * in SQL, so a developer without a database sees the same filtering.
 */
function matchesAnyPractice(rowTags: string[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  return rowTags.some((tag) => selected.includes(tag) || selected.includes(parentPracticeOf(tag)));
}

/** True when the row carries any of the selected values (plain OR, no subgroups). */
function matchesAny(rowValues: string[], selected: string[]): boolean {
  return selected.length === 0 || rowValues.some((value) => selected.includes(value));
}

function matchesSearch(eo: ExecutiveOrderListItem, needle: string): boolean {
  if (!needle) return true;
  const haystack = [eo.title, eo.eoNumber, eo.actionType, eo.aiSummary, ...eo.subjectArea]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(needle);
}

export async function searchLocalExecutiveOrders(query: TrackerQuery): Promise<TrackerResultPage> {
  const all = await getExecutiveOrders(null);
  const needle = query.search.trim().toLowerCase();

  const matched = all.filter((eo) => {
    if (!matchesSearch(eo, needle)) return false;
    if (!matchesAnyPractice(eo.practiceAreas, query.practiceAreas)) return false;
    if (!matchesAny(eo.industries, query.industries)) return false;
    if (query.status && eo.status !== query.status) return false;
    if (query.dateFrom && (!eo.dateSigned || eo.dateSigned < query.dateFrom)) return false;
    if (query.dateTo && (!eo.dateSigned || eo.dateSigned > query.dateTo)) return false;
    return true;
  });

  const total = matched.length;
  const start = offsetFor(query);
  const rows = query.pageSize === "all" ? matched : matched.slice(start, start + query.pageSize);

  return {
    rows,
    total,
    page: query.pageSize === "all" ? 1 : query.page,
    totalPages: totalPagesFor(total, query.pageSize),
  };
}
