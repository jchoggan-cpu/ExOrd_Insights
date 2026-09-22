import { INDUSTRIES, PRACTICE_AREAS, SUBJECT_AREAS, subPracticeTag } from "@/lib/taxonomy";
import { MultiSelectFilter, type FilterOption } from "@/components/multi-select-filter";
import { STATUSES, type TrackerQuery } from "@/lib/tracker-query";

/**
 * The filter controls, as a column beside the results on a wide screen and
 * a wrapping row above them on a narrow one.
 *
 * Split out of tracker-controls.tsx, which owns the state and the
 * navigation; this file only lays the controls out. Rendered inside that
 * client boundary, so it needs no "use client" of its own.
 *
 * Why a column: as a row above the results these filters cost a band of
 * vertical space across the full width, and only three orders fitted on a
 * 900px screen. Beside the results they cost width, which there is plenty
 * of, instead of height, which there is not.
 *
 * They wrap rather than scroll sideways when they are a row. A scrolling row
 * was the mockup's suggestion and it clips: each dropdown is an
 * absolutely-positioned panel, and an overflow-x-auto parent cuts it off at
 * the container edge.
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
  "rounded border border-control-border bg-surface px-3 py-2 text-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none";

interface TrackerFilterBarProps {
  query: TrackerQuery;
  onChange: (change: Partial<TrackerQuery>) => void;
}

export function TrackerFilterBar({ query, onChange }: TrackerFilterBarProps) {
  return (
    <div className="flex flex-wrap items-start gap-2 lg:flex-col lg:flex-nowrap">
      <p className="hidden w-full text-xs font-medium tracking-wide text-muted-foreground uppercase lg:block">
        Filter by
      </p>

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
        findPlaceholder="Find a practice area"
      />

      <MultiSelectFilter
        label="Industries"
        emptyLabel="All Industries"
        options={INDUSTRY_OPTIONS}
        selected={query.industries}
        onChange={(industries) => onChange({ industries })}
        findPlaceholder="Find an industry"
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

      <div className="flex min-w-0 flex-wrap items-center gap-2 text-sm text-muted-foreground lg:w-full">
        <span className="lg:w-full">Signed</span>
        <input
          type="date"
          value={query.dateFrom}
          max={query.dateTo || undefined}
          onChange={(e) => onChange({ dateFrom: e.target.value })}
          aria-label="Signed on or after"
          className={`w-36 ${CONTROL_CLASS} lg:w-full`}
        />
        <span>to</span>
        <input
          type="date"
          value={query.dateTo}
          min={query.dateFrom || undefined}
          onChange={(e) => onChange({ dateTo: e.target.value })}
          aria-label="Signed on or before"
          className={`w-36 ${CONTROL_CLASS} lg:w-full`}
        />
      </div>
    </div>
  );
}
