import Link from "next/link";
import { buildTrackerQueryString, type TrackerQuery } from "@/lib/tracker-query";
import { UNDO_PARAM } from "@/lib/tag-filter-link";

/**
 * Page navigation for the tracker.
 *
 * Real links, not buttons, so a page can be opened in a new tab, copied, and
 * crawled by the back button — and so this needs no client JavaScript at all.
 */

/** Page numbers to show either side of the current one before collapsing to an ellipsis. */
const WINDOW = 1;

/**
 * `undo` rides along through paging, because turning a page is not a
 * decision to keep the filters a tag click replaced. Changing a filter IS
 * such a decision, so the controls drop it -- they rebuild the URL from
 * TrackerQuery alone, which deliberately does not carry it.
 */
function hrefFor(query: TrackerQuery, page: number, undoFilters?: string): string {
  const qs = buildTrackerQueryString({ ...query, page });
  const withUndo = undoFilters
    ? `${qs}${qs ? "&" : ""}${UNDO_PARAM}=${encodeURIComponent(undoFilters)}`
    : qs;
  return withUndo ? `/?${withUndo}` : "/";
}

/**
 * The page numbers to render: always the first and last, always the ones
 * adjacent to the current page, with gaps collapsed. 25 pages of numbers
 * would otherwise wrap across the screen.
 */
export function paginationRange(current: number, totalPages: number): Array<number | "gap"> {
  const pages = new Set<number>([1, totalPages]);
  for (let page = current - WINDOW; page <= current + WINDOW; page++) {
    if (page >= 1 && page <= totalPages) pages.add(page);
  }

  const sorted = [...pages].sort((a, b) => a - b);
  const withGaps: Array<number | "gap"> = [];
  let previous = 0;
  for (const page of sorted) {
    if (previous && page - previous > 1) withGaps.push("gap");
    withGaps.push(page);
    previous = page;
  }
  return withGaps;
}

export function TrackerPagination({
  query,
  page,
  totalPages,
  undoFilters,
}: {
  query: TrackerQuery;
  page: number;
  totalPages: number;
  /** Carried through paging so a tag click stays undoable past page 1. */
  undoFilters?: string;
}) {
  // Nothing to navigate: one page, or the reader asked to see everything.
  if (totalPages <= 1 || query.pageSize === "all") return null;

  const linkClass =
    "rounded-md border border-border px-3 py-1.5 text-sm text-foreground hover:border-link hover:text-link";
  const disabledClass = "rounded-md border border-border/50 px-3 py-1.5 text-sm text-muted-foreground/50";

  return (
    <nav className="flex flex-wrap items-center justify-center gap-1.5" aria-label="Pagination">
      {page > 1 ? (
        <Link href={hrefFor(query, page - 1, undoFilters)} className={linkClass} rel="prev">
          ← Previous
        </Link>
      ) : (
        <span className={disabledClass}>← Previous</span>
      )}

      {paginationRange(page, totalPages).map((entry, index) =>
        entry === "gap" ? (
          <span key={`gap-${index}`} className="px-1 text-sm text-muted-foreground">
            …
          </span>
        ) : entry === page ? (
          <span
            key={entry}
            aria-current="page"
            className="rounded-md border border-link bg-link/10 px-3 py-1.5 text-sm font-medium text-link"
          >
            {entry}
          </span>
        ) : (
          <Link key={entry} href={hrefFor(query, entry, undoFilters)} className={linkClass}>
            {entry}
          </Link>
        ),
      )}

      {page < totalPages ? (
        <Link href={hrefFor(query, page + 1, undoFilters)} className={linkClass} rel="next">
          Next →
        </Link>
      ) : (
        <span className={disabledClass}>Next →</span>
      )}
    </nav>
  );
}
