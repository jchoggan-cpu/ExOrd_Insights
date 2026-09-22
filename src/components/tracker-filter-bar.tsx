import { INDUSTRIES, PRACTICE_AREAS, SUBJECT_AREAS, subPracticeTag } from "@/lib/taxonomy";
import { MultiSelectFilter, type FilterOption } from "@/components/multi-select-filter";
import { STATUSES, type TrackerQuery } from "@/lib/tracker-query";

/**
 * The search box and the filter controls.
 *
 * Split out of tracker-controls.tsx, which owns the state and the
 * navigation; this file only lays the controls out. Rendered inside that
 * client boundary, so it needs no "use client" of its own.
 *
 * The filters wrap onto a second line on a phone rather than scrolling
 * sideways as one row. A scrolling row was the mockup's suggestion and it
 * clips: each dropdown is an absolutely-positioned panel, and an
 * overflow-x-auto parent cuts it off at the container edge. Wrapping keeps
 * every filter reachable and the page free of sideways scroll, which is what
 * the scrolling row was for.
 */

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

// Subject leads the row because it is the one tag on 100% of rows. 26 of
// them is too many to scan, hence the find-as-you-type box.
const SUBJECT_OPTIONS: FilterOption[] = SUBJECT_AREAS.map((name) => ({ value: name, label: name }));

const CONTROL_CLASS =
  "rounded border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-link";

interface TrackerFilterBarProps {
  query: TrackerQuery;
  /** Local, debounced copy of the search box's contents. */
  searchText: string;
  onSearchTextChange: (value: string) => void;
  onChange: (change: Partial<TrackerQuery>) => void;
}

export function TrackerFilterBar({
  query,
  searchText,
  onSearchTextChange,
  onChange,
}: TrackerFilterBarProps) {
  return (
    <div className="flex flex-col gap-3">
      <div>
        <label
          htmlFor="tracker-search"
          className="mb-1 block text-xs font-medium tracking-wide text-muted-foreground uppercase"
        >
          Search the full text of every order
        </label>
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:gap-3">
          <input
            id="tracker-search"
            type="search"
            value={searchText}
            onChange={(e) => onSearchTextChange(e.target.value)}
            placeholder='Try "critical minerals" or tariff OR duty'
            className={`w-full max-w-lg ${CONTROL_CLASS}`}
          />
          <span className="text-xs text-muted-foreground">
            Quotes for a phrase &middot; OR for either word
          </span>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <MultiSelectFilter
          label="Subjects"
          emptyLabel="All Subjects"
          options={SUBJECT_OPTIONS}
          selected={query.subjects}
          onChange={(subjects) => onChange({ subjects })}
          findPlaceholder="Find a subject"
        />

        <MultiSelectFilter
          label="Practice areas"
          emptyLabel="All Practice Areas"
          options={PRACTICE_AREA_OPTIONS}
          selected={query.practiceAreas}
          onChange={(practiceAreas) => onChange({ practiceAreas })}
        />

        <MultiSelectFilter
          label="Industries"
          emptyLabel="All Industries"
          options={INDUSTRY_OPTIONS}
          selected={query.industries}
          onChange={(industries) => onChange({ industries })}
        />

        <select
          value={query.status}
          onChange={(e) => onChange({ status: e.target.value })}
          aria-label="Filter by status"
          className={CONTROL_CLASS}
        >
          <option value="">All Statuses</option>
          {STATUSES.map((status) => (
            <option key={status} value={status}>
              {status[0].toUpperCase() + status.slice(1)}
            </option>
          ))}
        </select>

        <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground">
          <span>Signed</span>
          <input
            type="date"
            value={query.dateFrom}
            max={query.dateTo || undefined}
            onChange={(e) => onChange({ dateFrom: e.target.value })}
            aria-label="Signed on or after"
            className={`w-36 ${CONTROL_CLASS}`}
          />
          <span>to</span>
          <input
            type="date"
            value={query.dateTo}
            min={query.dateFrom || undefined}
            onChange={(e) => onChange({ dateTo: e.target.value })}
            aria-label="Signed on or before"
            className={`w-36 ${CONTROL_CLASS}`}
          />
        </div>
      </div>
    </div>
  );
}
