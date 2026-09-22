import { describe, expect, it, vi } from "vitest";
import { createSelectionStore, type SelectionStorage } from "@/lib/eo-selection-store";
import { SELECTION_STORAGE_KEY } from "@/lib/eo-selection";

function fakeStorage(initial: Record<string, string> = {}): SelectionStorage & {
  contents: Record<string, string>;
} {
  const contents = { ...initial };
  return {
    contents,
    getItem: (key) => contents[key] ?? null,
    setItem: (key, value) => {
      contents[key] = value;
    },
  };
}

/** A browser with site data blocked: touching storage at all throws. */
function throwingStorage(): SelectionStorage {
  return {
    getItem: () => {
      throw new Error("access denied");
    },
    setItem: () => {
      throw new Error("access denied");
    },
  };
}

describe("createSelectionStore", () => {
  it("starts from what is already in storage", () => {
    const store = createSelectionStore(fakeStorage({ [SELECTION_STORAGE_KEY]: '["a","b"]' }));
    expect(store.getSnapshot()).toEqual(["a", "b"]);
  });

  it("renders nothing selected on the server, whatever is stored", () => {
    const store = createSelectionStore(fakeStorage({ [SELECTION_STORAGE_KEY]: '["a"]' }));
    expect(store.getServerSnapshot()).toEqual([]);
  });

  it("persists a change so it survives a page change", () => {
    const storage = fakeStorage();
    const store = createSelectionStore(storage);

    store.toggle("a");
    store.toggle("b");

    expect(store.getSnapshot()).toEqual(["a", "b"]);
    // A fresh store is what a soft navigation or a reload produces.
    expect(createSelectionStore(storage).getSnapshot()).toEqual(["a", "b"]);
  });

  it("notifies subscribers on every change, and stops after unsubscribe", () => {
    const store = createSelectionStore(fakeStorage());
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.toggle("a");
    store.clear();
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    store.toggle("b");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("returns the same reference for an empty selection", () => {
    // useSyncExternalStore re-renders whenever getSnapshot returns a new
    // reference, so a fresh [] each time would loop forever.
    const store = createSelectionStore(fakeStorage());
    const before = store.getSnapshot();

    store.toggle("a");
    store.toggle("a");

    expect(store.getSnapshot()).toBe(before);
  });

  it("gives a stable snapshot when nothing changed", () => {
    const store = createSelectionStore(fakeStorage());
    store.toggle("a");
    expect(store.getSnapshot()).toBe(store.getSnapshot());
  });

  it("keeps working in memory when storage refuses every call", () => {
    const store = createSelectionStore(throwingStorage());

    expect(store.getSnapshot()).toEqual([]);
    store.toggle("a");

    // The selection still works for this page; it just will not survive a
    // navigation. What it must not do is throw on a tracker render.
    expect(store.getSnapshot()).toEqual(["a"]);
  });

  it("works in memory with no storage at all", () => {
    // This is the instance the server imports, and the one a browser gets
    // when it refuses sessionStorage outright. Same contract as the
    // throwing case above: the selection works for this page and does not
    // survive a navigation.
    const store = createSelectionStore(null);

    expect(store.getSnapshot()).toEqual([]);
    store.toggle("a");
    expect(store.getSnapshot()).toEqual(["a"]);
    // Whatever is in memory, a server render still starts from empty.
    expect(store.getServerSnapshot()).toEqual([]);
  });

  it("clears everything", () => {
    const store = createSelectionStore(fakeStorage({ [SELECTION_STORAGE_KEY]: '["a","b"]' }));
    store.clear();
    expect(store.getSnapshot()).toEqual([]);
  });
});
