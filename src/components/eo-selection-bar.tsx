"use client";

import Link from "next/link";
import { draftHrefFor, selectionLabel } from "@/lib/eo-selection";
import { useEoSelection } from "@/components/use-eo-selection";

/**
 * The bar that follows the reader down the page once orders are ticked, and
 * hands them to the drafter.
 *
 * Absent rather than empty when nothing is selected: a permanent bar would
 * cost a strip of screen on a phone to say "0 orders".
 */
export function EoSelectionBar() {
  const { selected, clear } = useEoSelection();

  // Nothing on the server render and nothing when the reader has ticked
  // nothing: a permanent bar would cost a strip of a phone screen to say
  // "0 orders".
  if (selected.length === 0) return null;

  return (
    <div className="sticky bottom-0 z-20 -mx-4 mt-2 border-t border-border bg-header px-4 py-3 text-header-foreground shadow-lg">
      <div className="mx-auto flex max-w-[120rem] flex-wrap items-center justify-between gap-3">
        <span className="text-sm">
          <span className="font-semibold">{selectionLabel(selected.length)}</span> selected
        </span>

        <div className="flex items-center gap-4">
          <button
            type="button"
            onClick={clear}
            className="text-sm text-header-foreground/80 hover:text-header-foreground hover:underline"
          >
            Clear selection
          </button>
          <Link
            href={draftHrefFor(selected)}
            className="rounded bg-header-foreground px-3 py-1.5 text-sm font-semibold text-header transition-opacity hover:opacity-90"
          >
            Draft from {selectionLabel(selected.length)}
          </Link>
        </div>
      </div>
    </div>
  );
}
