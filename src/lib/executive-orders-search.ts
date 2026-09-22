import type { SupabaseClient } from "@supabase/supabase-js";
import { getSupabaseClient } from "@/lib/supabase";
import type { ExecutiveOrderListItem } from "@/lib/types";
import {
  countRowsSharingEoNumbers,
  flagDuplicatesFromCounts,
} from "@/lib/duplicate-eo-numbers";
import { offsetFor, totalPagesFor, type TrackerQuery } from "@/lib/tracker-query";
import { searchLocalExecutiveOrders } from "@/lib/executive-orders-search-local";

/**
 * One page of tracker results: searched, filtered, sorted and counted by
 * Postgres rather than by the browser.
 *
 * Everything happens in the `search_executive_orders` function (migrations
 * 0007 and 0008) rather than as REST query parameters, because relevance ordering
 * needs ORDER BY ts_rank(...) and PostgREST can only order by real columns.
 * Folding the count in with the rows also means the total and the page come
 * from one snapshot instead of two queries that could disagree.
 */

export interface TrackerResultPage {
  rows: ExecutiveOrderListItem[];
  /** Matches before paging — what "N results" and the page count are built from. */
  total: number;
  page: number;
  totalPages: number;
}

/** Shape returned by the search_executive_orders function. */
interface SearchRow {
  id: string;
  eo_number: string | null;
  action_type: string | null;
  title: string;
  date_signed: string | null;
  status: ExecutiveOrderListItem["status"];
  subject_area: string[];
  practice_areas: string[];
  industries: string[];
  legal_challenges: ExecutiveOrderListItem["legalChallenges"];
  needs_review: boolean;
  review_reason: string | null;
  ai_summary: string | null;
  snippet: string | null;
  total_count: number;
}

function mapSearchRow(row: SearchRow): ExecutiveOrderListItem {
  return {
    id: row.id,
    eoNumber: row.eo_number ?? undefined,
    actionType: row.action_type ?? undefined,
    title: row.title,
    dateSigned: row.date_signed ?? "",
    status: row.status,
    subjectArea: row.subject_area ?? [],
    practiceAreas: row.practice_areas ?? [],
    industries: row.industries ?? [],
    legalChallenges: row.legal_challenges ?? [],
    needsReview: row.needs_review,
    needsReviewReason: row.review_reason ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
    snippet: row.snippet ?? undefined,
  };
}

export async function searchExecutiveOrders(
  query: TrackerQuery,
  supabase: SupabaseClient | null = getSupabaseClient(),
): Promise<TrackerResultPage> {
  // Without a database, fall back to filtering the bundled legacy data in
  // memory so local development still has a working tracker (same reasoning
  // as getExecutiveOrders'). Correctness over speed: that dataset is small.
  if (!supabase) {
    return searchLocalExecutiveOrders(query);
  }

  const { data, error } = await supabase.rpc("search_executive_orders", {
    p_search: query.search || null,
    // Empty arrays would be indistinguishable from "filter to nothing" if the
    // function treated them literally; it reads null and empty the same way,
    // and null is the clearer signal of "not filtering on this".
    p_subjects: query.subjects.length > 0 ? query.subjects : null,
    p_practice_areas: query.practiceAreas.length > 0 ? query.practiceAreas : null,
    p_industries: query.industries.length > 0 ? query.industries : null,
    p_status: query.status || null,
    p_date_from: query.dateFrom || null,
    p_date_to: query.dateTo || null,
    p_sort: query.sort,
    // null is the function's "no limit" — the "All" page-size option.
    p_limit: query.pageSize === "all" ? null : query.pageSize,
    p_offset: offsetFor(query),
  });

  if (error) {
    // Loud, not silent: an empty tracker that should have had 553 rows is
    // indistinguishable from "nothing matched" unless this is surfaced.
    console.error("Tracker search failed:", error);
    throw new Error(`Tracker search failed: ${error.message}`);
  }

  const searchRows = (data ?? []) as SearchRow[];
  // count(*) over () repeats the total on every row; an empty page has none.
  const total = searchRows[0]?.total_count ?? 0;
  const rows = searchRows.map(mapSearchRow);

  // Duplicate EO numbers are a whole-table property, so they are counted
  // against the table rather than against this page — otherwise two
  // duplicates on different pages would both read as unique.
  const counts = await countRowsSharingEoNumbers(
    supabase,
    rows.map((row) => row.eoNumber).filter((n): n is string => Boolean(n)),
  );

  return {
    rows: flagDuplicatesFromCounts(rows, counts),
    total: Number(total),
    page: query.pageSize === "all" ? 1 : query.page,
    totalPages: totalPagesFor(Number(total), query.pageSize),
  };
}
