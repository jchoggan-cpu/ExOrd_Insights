/**
 * Which orders a reader has ticked on the tracker, on the way to drafting
 * something from them.
 *
 * Pure: no React, no storage calls, no navigation. The provider that holds
 * the live selection and the bar that shows it both go through here, so the
 * awkward parts -- surviving a page change, tolerating whatever is in
 * sessionStorage -- are covered by tests rather than by clicking.
 */

/**
 * Selection lives in sessionStorage rather than in the URL. Ticking a row is
 * not a filter, so it should not change what a shared link shows, and it
 * should not add a history entry per click. Per-tab and cleared when the tab
 * closes, which matches how long a drafting session lasts.
 */
export const SELECTION_STORAGE_KEY = "eo-tracker:selected-orders";

/**
 * The drafter takes its orders from repeated eoId parameters. Kept here with
 * the rest of the selection vocabulary so the tracker and the draft page
 * cannot disagree about the parameter's name.
 */
export const DRAFT_ID_PARAM = "eoId";

export function isSelected(selected: readonly string[], id: string): boolean {
  return selected.includes(id);
}

/** Adds or removes one order, preserving the order things were ticked in. */
export function toggleSelection(selected: readonly string[], id: string): string[] {
  return isSelected(selected, id) ? selected.filter((s) => s !== id) : [...selected, id];
}

/** Where the "Draft from N orders" button goes. */
export function draftHrefFor(selected: readonly string[]): string {
  const params = new URLSearchParams();
  for (const id of selected) params.append(DRAFT_ID_PARAM, id);
  const qs = params.toString();
  return qs ? `/draft?${qs}` : "/draft";
}

export function serializeSelection(selected: readonly string[]): string {
  return JSON.stringify(selected);
}

/**
 * Reads a stored selection back.
 *
 * Deliberately tolerant and never throws: sessionStorage is editable by
 * hand, survives a deploy that changed this format, and can hold anything.
 * A selection that cannot be understood becomes an empty one -- the reader
 * re-ticks two rows -- rather than an exception on every tracker render.
 */
export function parseStoredSelection(raw: string | null): string[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON at all. Nothing to recover, and nothing worth reporting: the
    // only cost is an empty selection.
    return [];
  }

  if (!Array.isArray(parsed)) return [];
  return [...new Set(parsed.filter((id): id is string => typeof id === "string" && id.length > 0))];
}

/** "3 orders" / "1 order", for the bar's label. */
export function selectionLabel(count: number): string {
  return `${count} ${count === 1 ? "order" : "orders"}`;
}
