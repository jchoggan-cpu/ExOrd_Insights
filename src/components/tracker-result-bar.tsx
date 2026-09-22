import Link from "next/link";
import { activeFilterChips, CLEARED_FILTERS, hasActiveFilters } from "@/lib/tracker-filter-chips";
import { undoHref } from "@/lib/tag-filter-link";
import { PAGE_SIZES, type PageSize, type TrackerQuery } from "@/lib/tracker-query";

/**
 * The line between the filters and the results: how many matched, what is
 * being applied, how it is sorted, and how many to a page.
 *
 * Split out of tracker-controls.tsx, which owns the state and the
 * navigation. Which chips to show is decided by tracker-filter-chips.ts, so
 * that logic is covered by tests without rendering anything.
 */

const CONTROL_CLASS =
  "rounded border border-control-border bg-surface px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface TrackerResultBarProps {
  query: TrackerQuery;
  total: number;
  /** The previous query string, when a tag click replaced the filters. */
  undoFilters?: string;
  onChange: (change: Partial<TrackerQuery>) => void;
}

export function TrackerResultBar({ query, total, undoFilters, onChange }: TrackerResultBarProps) {
  const filtered = hasActiveFilters(query);
  const chips = activeFilterChips(query);

  return (
    <div className="flex flex-col gap-2 border-t border-border pt-3">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 text-sm text-muted-foreground">
        <span className="flex flex-col leading-tight">
          <span className="font-medium text-foreground">
            {total.toLocaleString()} {total === 1 ? "order" : "orders"}
            {filtered && " match"}
          </span>
          {/* The row checkboxes are easy to miss, and nothing else on the
              page says what they are for. */}
          <span className="text-xs">(select to create alert/content)</span>
        </span>

        {chips.map((chip) => (
          <button
            key={chip.key}
            type="button"
            onClick={() => onChange(chip.clears)}
            title={`Remove filter: ${chip.label}`}
            className="inline-flex items-center gap-1.5 rounded bg-muted px-2 py-0.5 text-xs text-foreground hover:bg-border focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [@media(pointer:coarse)]:py-1"
          >
            {chip.label}
            <span aria-hidden="true" className="text-muted-foreground">
              &times;
            </span>
            <span className="sr-only">Remove this filter</span>
          </button>
        ))}

        {filtered && (
          <button
            type="button"
            onClick={() => onChange(CLEARED_FILTERS)}
            className="text-link hover:underline"
          >
            Clear all
          </button>
        )}

        {/* A tag click replaces the filters rather than adding to them, so
            the way back has to be offered rather than assumed. */}
        {undoFilters && (
          <Link href={undoHref(undoFilters)} className="text-link hover:underline">
            Undo tag filter
          </Link>
        )}

        <span className="ml-auto flex flex-wrap items-center gap-x-3 gap-y-2">
          {query.sort === "relevance" && query.search && (
            <span>
              Sorted by <span className="font-medium text-foreground">relevance</span> (switched on
              because you searched)
            </span>
          )}

          <label className="flex items-center gap-1.5">
            Sort
            <select
              value={query.sort}
              onChange={(e) => onChange({ sort: e.target.value as TrackerQuery["sort"] })}
              aria-label="Sort results"
              className={CONTROL_CLASS}
            >
              <option value="date">Newest first</option>
              {/* With no search term every row ranks equally, so relevance
                  really would behave as date order. Searching now selects
                  this automatically, so the disabled case is only reached by
                  someone opening the dropdown with an empty search box. */}
              <option value="relevance" disabled={!query.search}>
                Most relevant{!query.search ? " (type a search first)" : ""}
              </option>
            </select>
          </label>

          <label className="flex items-center gap-1.5">
            Show
            <select
              value={String(query.pageSize)}
              onChange={(e) =>
                onChange({
                  pageSize: (e.target.value === "all" ? "all" : Number(e.target.value)) as PageSize,
                })
              }
              aria-label="Orders per page"
              className={CONTROL_CLASS}
            >
              {PAGE_SIZES.map((size) => (
                <option key={size} value={size}>
                  {size} per page
                </option>
              ))}
              <option value="all">All</option>
            </select>
          </label>
        </span>
      </div>
    </div>
  );
}
