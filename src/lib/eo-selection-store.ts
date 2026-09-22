import { parseStoredSelection, SELECTION_STORAGE_KEY, serializeSelection, toggleSelection } from "@/lib/eo-selection";

/**
 * The live selection, as an external store React can subscribe to.
 *
 * sessionStorage is exactly what useSyncExternalStore exists for: state that
 * lives outside React, that the server cannot see, and that several
 * components have to agree about. Reading it into state from an effect is
 * the obvious alternative and is what this replaced -- the React Compiler
 * lint rule rejects it, and it is genuinely worse, because every checkbox
 * and the bar would each hold their own copy.
 *
 * Storage is passed in rather than reached for, so the store can be tested
 * against a fake -- including the case where storage throws on every call.
 */

/** The slice of the Storage API this needs. */
export interface SelectionStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface SelectionStore {
  subscribe(listener: () => void): () => void;
  /** Stable between renders unless the selection actually changed. */
  getSnapshot(): readonly string[];
  /** The server cannot read sessionStorage, so it renders nothing selected. */
  getServerSnapshot(): readonly string[];
  toggle(id: string): void;
  clear(): void;
}

/**
 * Shared by every snapshot that is empty. useSyncExternalStore re-renders
 * whenever getSnapshot returns a new reference, so "no selection" has to be
 * the same array every time or it loops.
 */
const NONE: readonly string[] = Object.freeze([]);

export function createSelectionStore(storage: SelectionStorage | null): SelectionStore {
  let current: readonly string[] | undefined;
  const listeners = new Set<() => void>();

  function read(): readonly string[] {
    if (!storage) return NONE;
    try {
      const stored = parseStoredSelection(storage.getItem(SELECTION_STORAGE_KEY));
      return stored.length === 0 ? NONE : stored;
    } catch {
      // Storage can be unavailable outright -- a private window, or blocked
      // site data. Selection is a convenience and nothing else depends on
      // it, so an empty selection is the right answer rather than an
      // exception on every tracker render.
      return NONE;
    }
  }

  function write(next: readonly string[]): void {
    if (!storage) return;
    try {
      storage.setItem(SELECTION_STORAGE_KEY, serializeSelection(next));
    } catch {
      // The in-memory selection still works for this page; it just will not
      // survive a navigation.
    }
  }

  function commit(next: readonly string[]): void {
    current = next.length === 0 ? NONE : next;
    write(current);
    for (const listener of listeners) listener();
  }

  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    getSnapshot() {
      // Hydrated on first read rather than at construction: this module is
      // imported during the server render too, where there is no storage.
      current ??= read();
      return current;
    },

    getServerSnapshot() {
      return NONE;
    },

    toggle(id) {
      current ??= read();
      commit(toggleSelection(current, id));
    },

    clear() {
      commit(NONE);
    },
  };
}

/**
 * The instance the tracker uses. `null` storage on the server, and in any
 * browser that refuses to hand sessionStorage over at all.
 */
export const selectionStore = createSelectionStore(
  typeof window === "undefined" ? null : safeSessionStorage(),
);

function safeSessionStorage(): SelectionStorage | null {
  try {
    return window.sessionStorage;
  } catch {
    // Accessing the property itself throws when site data is blocked.
    return null;
  }
}
