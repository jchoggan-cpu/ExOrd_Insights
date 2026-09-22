"use client";

import { useSyncExternalStore } from "react";
import { selectionStore } from "@/lib/eo-selection-store";

/**
 * The orders currently ticked on the tracker, and the two ways to change
 * that set.
 *
 * Every checkbox and the bar read the same store, so they cannot disagree,
 * and no provider has to be threaded through the server-rendered rows.
 */
export function useEoSelection() {
  const selected = useSyncExternalStore(
    selectionStore.subscribe,
    selectionStore.getSnapshot,
    selectionStore.getServerSnapshot,
  );

  return { selected, toggle: selectionStore.toggle, clear: selectionStore.clear };
}
