"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { INDUSTRIES, PRACTICE_AREAS, subPracticeTag } from "@/lib/taxonomy";
import { MultiSelectFilter, type FilterOption } from "@/components/multi-select-filter";
import {
  buildTrackerQueryString,
  PAGE_SIZES,
  STATUSES,
  withTrackerChange,
  type PageSize,
  type TrackerQuery,
} from "@/lib/tracker-query";

/**
 * The tracker's search box and dropdowns.
 *
 * The only client component on the page — the table itself is rendered on
 * the server now, so 614 rows of markup no longer ship as JavaScript.
 *
 * Current state arrives as a prop rather than from useSearchParams(), which
 * keeps this out of a Suspense boundary and keeps the server as the single
 * source of truth for what is being shown.
 */

/**
 * How long to wait after the last keystroke before searching. Each search is
 * a database round trip, so firing per character would issue a dozen queries
 * for one word and race their responses. 300ms is below the threshold where
 * typing feels laggy and above the gap between keystrokes.
 */
const SEARCH_DEBOUNCE_MS = 300;

/**
 * Practice areas with their subgroups listed underneath. Selecting a parent
 * already matches every subgroup of it, so the subgroups are here for
 * narrowing to one part of a practice rather than for completeness.
 */
const PRACTICE_AREA_OPTIONS: FilterOption[] = PRACTICE_AREAS.flatMap((area) => [
  { value: area.name, label: area.name },
  ...(area.subPractices ?? [])
    .filter((sub) => sub.criteria)
    .map((sub) => ({
      value: subPracticeTag(area.name, sub.name),
      label: sub.name,
      isSubOption: true,
    })),
]);

const INDUSTRY_OPTIONS: FilterOption[] = INDUSTRIES.map((name) => ({ value: name, label: name }));

const SELECT_CLASS =
  "rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-link";

export function TrackerControls({ query, total }: { query: TrackerQuery; total: number }) {
  const router = useRouter();
  const [searchText, setSearchText] = useState(query.search);
  // Tracks whether the pending change came from this component, so the sync
  // below doesn't fight the user mid-keystroke.
  const isTypingRef = useRef(false);

  function navigate(change: Partial<TrackerQuery>) {
    const next = withTrackerChange(query, change);
    const qs = buildTrackerQueryString(next);
    // replace, not push: typing a search shouldn't bury the previous page in
    // history so the back button has to be pressed once per character.
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
  }

  // Debounce the search box. Everything else navigates immediately — a
  // dropdown is one deliberate choice, not a stream of them.
  useEffect(() => {
    if (searchText === query.search) return;
    isTypingRef.current = true;
    const timer = setTimeout(() => {
      navigate({ search: searchText });
      isTypingRef.current = false;
    }, SEARCH_DEBOUNCE_MS);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchText]);

  // Keep the box in step when the URL changes from outside — the back
  // button, or a shared link — but never while someone is mid-word.
  useEffect(() => {
    if (!isTypingRef.current) setSearchText(query.search);
  }, [query.search]);

  const hasFilters = Boolean(
    query.search ||
      query.practiceAreas.length ||
      query.industries.length ||
      query.status ||
      query.dateFrom ||
      query.dateTo,
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          value={searchText}
          onChange={(e) => setSearchText(e.target.value)}
          placeholder='Search orders — try "critical minerals" or tariff OR duty'
          aria-label="Search executive orders"
          className="w-full max-w-md rounded-md border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-link"
        />

        <MultiSelectFilter
          label="Practice areas"
          emptyLabel="All Practice Areas"
          options={PRACTICE_AREA_OPTIONS}
          selected={query.practiceAreas}
          onChange={(practiceAreas) => navigate({ practiceAreas })}
        />

        <MultiSelectFilter
          label="Industries"
          emptyLabel="All Industries"
          options={INDUSTRY_OPTIONS}
          selected={query.industries}
          onChange={(industries) => navigate({ industries })}
        />

        <select
          value={query.status}
          onChange={(e) => navigate({ status: e.target.value })}
          aria-label="Filter by status"
          className={SELECT_CLASS}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status[0].toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>

        <label className="flex items-center gap-2 text-sm text-muted">
          Signed
          <input
            type="date"
            value={query.dateFrom}
            max={query.dateTo || undefined}
            onChange={(e) => navigate({ dateFrom: e.target.value })}
            aria-label="Signed on or after"
            className={SELECT_CLASS}
          />
          to
          <input
            type="date"
            value={query.dateTo}
            min={query.dateFrom || undefined}
            onChange={(e) => navigate({ dateTo: e.target.value })}
            aria-label="Signed on or before"
            className={SELECT_CLASS}
          />
        </label>
      </div>

      <div className="flex flex-wrap items-center gap-3 text-sm text-muted">
        <span>
          {total.toLocaleString()} {total === 1 ? "order" : "orders"}
          {hasFilters && " match"}
        </span>

        <label className="flex items-center gap-1.5">
          Sort
          <select
            value={query.sort}
            onChange={(e) => navigate({ sort: e.target.value as TrackerQuery["sort"] })}
            aria-label="Sort results"
            className={SELECT_CLASS}
          >
            <option value="date">Newest first</option>
            {/* With no search term every row ranks equally, so relevance
                would silently behave as date order — say so rather than
                offering a control that appears to do nothing. */}
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
              navigate({
                pageSize: (e.target.value === "all" ? "all" : Number(e.target.value)) as PageSize,
              })
            }
            aria-label="Orders per page"
            className={SELECT_CLASS}
          >
            {PAGE_SIZES.map((size) => (
              <option key={size} value={size}>
                {size} per page
              </option>
            ))}
            <option value="all">All</option>
          </select>
        </label>

        {hasFilters && (
          <button
            type="button"
            onClick={() =>
              navigate({
                search: "",
                practiceAreas: [],
                industries: [],
                status: "",
                dateFrom: "",
                dateTo: "",
                sort: "date",
              })
            }
            className="text-link hover:underline"
          >
            Clear filters
          </button>
        )}
      </div>
    </div>
  );
}
