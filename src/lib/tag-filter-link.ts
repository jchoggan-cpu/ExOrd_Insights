import {
  buildTrackerQueryString,
  parseTrackerQuery,
  type RawSearchParams,
  type TrackerQuery,
} from "@/lib/tracker-query";
import { CLEARED_FILTERS } from "@/lib/tracker-filter-chips";

/**
 * Where a tag on a results row links to.
 *
 * Clicking a tag REPLACES whatever was filtered rather than adding to it, so
 * you always know what you are looking at: adding would let a click land on
 * an empty page whenever the new tag shares no rows with the old filters,
 * with nothing on screen explaining why. The cost is that a deliberate
 * filter can be wiped by a stray click, so the link carries the previous
 * query string and the results bar offers a one-click way back.
 *
 * Pure and computed on the server, so the tags stay ordinary links and the
 * rows ship no JavaScript.
 */

export type TagFilterKind = "subject" | "practice" | "industry";

/** The query parameter carrying "what the filters were before this click". */
export const UNDO_PARAM = "undo";

const FIELD_FOR_KIND: Record<TagFilterKind, "subjects" | "practiceAreas" | "industries"> = {
  subject: "subjects",
  practice: "practiceAreas",
  industry: "industries",
};

function trackerHref(queryString: string): string {
  return queryString ? `/?${queryString}` : "/";
}

export function tagFilterHref(
  current: TrackerQuery,
  kind: TagFilterKind,
  value: string,
): string {
  const replaced = buildTrackerQueryString({
    ...CLEARED_FILTERS,
    // Page size is a display preference, not a filter. CLEARED_FILTERS omits
    // it deliberately, and "Clear all" keeps it because that path spreads
    // onto the current query; this one does not, so it has to be carried
    // explicitly or a reader on "All" is silently dropped back to 25.
    pageSize: current.pageSize,
    [FIELD_FOR_KIND[kind]]: [value],
  });

  // Nothing was filtered, so there is nothing to undo and no reason to carry
  // an empty parameter around in a URL people share.
  const previous = buildTrackerQueryString(current);
  if (!previous) return trackerHref(replaced);

  return `${trackerHref(replaced)}&${UNDO_PARAM}=${encodeURIComponent(previous)}`;
}

/**
 * Where the "undo" link goes.
 *
 * The value arrives from a URL a person can edit, so it is put through the
 * tracker's own parser and re-serialized rather than pasted into an href.
 * That way an `undo` of "https://elsewhere.example" cannot become a link off
 * the site, and an unrecognized parameter is dropped rather than carried.
 */
export function undoHref(rawUndo: string): string {
  const params = new URLSearchParams(rawUndo);
  const asSearchParams: RawSearchParams = {};
  for (const key of new Set(params.keys())) {
    const values = params.getAll(key);
    asSearchParams[key] = values.length > 1 ? values : values[0];
  }
  return trackerHref(buildTrackerQueryString(parseTrackerQuery(asSearchParams)));
}
