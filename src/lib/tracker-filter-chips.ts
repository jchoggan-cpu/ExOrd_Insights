import { formatTagLabel } from "@/lib/tag-label";
import type { TrackerQuery } from "@/lib/tracker-query";

/**
 * What is currently narrowing the results, as a list of removable chips.
 *
 * On a phone the filter controls scroll out of sight, so "557 orders" and
 * "12 orders" look like the same screen with a different number on it.
 * These chips state what is being applied where the reader is looking, and
 * each one carries the change that removes just itself -- so dropping one
 * industry doesn't clear the other four.
 *
 * Pure: the query in, chips out, no navigation. That keeps it testable
 * without rendering anything, which is the only way UI logic gets covered in
 * this repo today (vitest runs in node and collects *.test.ts only).
 */

export interface FilterChip {
  /** Stable React key. */
  key: string;
  label: string;
  /** The change to apply to remove this one filter and nothing else. */
  clears: Partial<TrackerQuery>;
}

/** Everything a "Clear all" resets. Sort goes back to newest-first because
 *  clearing the search leaves relevance with nothing to rank against. */
export const CLEARED_FILTERS: Partial<TrackerQuery> = {
  search: "",
  practiceAreas: [],
  industries: [],
  status: "",
  dateFrom: "",
  dateTo: "",
  sort: "date",
};

function withoutValue(values: string[], value: string): string[] {
  return values.filter((v) => v !== value);
}

export function hasActiveFilters(query: TrackerQuery): boolean {
  return Boolean(
    query.search ||
      query.practiceAreas.length ||
      query.industries.length ||
      query.status ||
      query.dateFrom ||
      query.dateTo,
  );
}

export function activeFilterChips(query: TrackerQuery): FilterChip[] {
  const chips: FilterChip[] = [];

  if (query.search) {
    chips.push({
      key: "search",
      label: `Full text: ${query.search}`,
      clears: { search: "" },
    });
  }

  for (const area of query.practiceAreas) {
    chips.push({
      key: `practice:${area}`,
      label: `Practice: ${formatTagLabel(area)}`,
      clears: { practiceAreas: withoutValue(query.practiceAreas, area) },
    });
  }

  for (const industry of query.industries) {
    chips.push({
      key: `industry:${industry}`,
      label: `Industry: ${industry}`,
      clears: { industries: withoutValue(query.industries, industry) },
    });
  }

  if (query.status) {
    chips.push({
      key: "status",
      label: `Status: ${query.status[0].toUpperCase()}${query.status.slice(1)}`,
      clears: { status: "" },
    });
  }

  // One chip for a range, two for a half-open one, so "Signed from ..." with
  // no end date doesn't read as though an end date were being applied.
  if (query.dateFrom && query.dateTo) {
    chips.push({
      key: "dates",
      label: `Signed ${query.dateFrom} to ${query.dateTo}`,
      clears: { dateFrom: "", dateTo: "" },
    });
  } else if (query.dateFrom) {
    chips.push({
      key: "dateFrom",
      label: `Signed on or after ${query.dateFrom}`,
      clears: { dateFrom: "" },
    });
  } else if (query.dateTo) {
    chips.push({
      key: "dateTo",
      label: `Signed on or before ${query.dateTo}`,
      clears: { dateTo: "" },
    });
  }

  return chips;
}
