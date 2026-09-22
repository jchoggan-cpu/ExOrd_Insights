import { parentPracticeOf } from "@/lib/taxonomy";
import type { ExecutiveOrderListItem } from "@/lib/types";

/**
 * Narrowing the drafter's order list, in the browser.
 *
 * Deliberately NOT the tracker's search. That one runs in Postgres, ranks by
 * relevance and can reach the body text of every order; this one filters a
 * list already in the page, so it can only see what the list carries --
 * title, number, action type, summary and tags. The difference is stated in
 * the UI rather than hidden, because a drafter search that quietly missed
 * body-text matches would be worse than one that says it only reads titles.
 *
 * Client-side on purpose: filtering here changes no URL and triggers no
 * navigation, so the orders already ticked for drafting cannot be lost by
 * typing in a search box.
 *
 * Pure, so it is covered without rendering anything.
 */

export interface PickerFilters {
  search: string;
  subjects: string[];
  practiceAreas: string[];
  industries: string[];
  status: string;
}

export const NO_PICKER_FILTERS: PickerFilters = {
  search: "",
  subjects: [],
  practiceAreas: [],
  industries: [],
  status: "",
};

/** True when nothing is selected, or the row carries any selected value. */
function matchesAny(rowValues: string[], selected: string[]): boolean {
  return selected.length === 0 || rowValues.some((value) => selected.includes(value));
}

/**
 * A selected parent practice area also matches its subgroups, the same rule
 * migration 0008 applies in SQL, so the two filters mean the same thing in
 * both places.
 */
function matchesAnyPractice(rowTags: string[], selected: string[]): boolean {
  if (selected.length === 0) return true;
  return rowTags.some((tag) => selected.includes(tag) || selected.includes(parentPracticeOf(tag)));
}

function matchesSearch(order: ExecutiveOrderListItem, needle: string): boolean {
  if (!needle) return true;
  return [order.title, order.eoNumber, order.actionType, order.aiSummary, ...order.subjectArea]
    .filter(Boolean)
    .join(" ")
    .toLowerCase()
    .includes(needle);
}

export function filterPickerOrders(
  orders: ExecutiveOrderListItem[],
  filters: PickerFilters,
  /**
   * Orders already ticked stay in the list whatever the filters say.
   * Otherwise narrowing the list hides what you selected, and the only way
   * to see it again is to undo the filter -- with the count of selected
   * orders silently disagreeing with what is on screen.
   */
  alwaysKeep: ReadonlySet<string> = new Set(),
): ExecutiveOrderListItem[] {
  const needle = filters.search.trim().toLowerCase();

  return orders.filter((order) => {
    if (alwaysKeep.has(order.id)) return true;
    if (!matchesSearch(order, needle)) return false;
    if (!matchesAny(order.subjectArea, filters.subjects)) return false;
    if (!matchesAnyPractice(order.practiceAreas, filters.practiceAreas)) return false;
    if (!matchesAny(order.industries, filters.industries)) return false;
    if (filters.status && order.status !== filters.status) return false;
    return true;
  });
}

export function hasPickerFilters(filters: PickerFilters): boolean {
  return Boolean(
    filters.search.trim() ||
      filters.subjects.length ||
      filters.practiceAreas.length ||
      filters.industries.length ||
      filters.status,
  );
}
