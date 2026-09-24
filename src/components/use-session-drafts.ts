"use client";

import { useCallback, useSyncExternalStore } from "react";
import {
  addSessionDraft,
  deleteTokenFor,
  parseSessionDrafts,
  removeSessionDraft,
  serializeSessionDrafts,
  SESSION_DRAFTS_KEY,
  type SessionDraft,
} from "@/lib/session-drafts";

/**
 * The drafts this browser session created, so the delete control survives a
 * page change rather than only the render that produced it.
 *
 * Read through useSyncExternalStore for the same reason the tracker's order
 * selection is: sessionStorage is state outside React that the server cannot
 * see, and copying it into component state from an effect gives every
 * component its own diverging copy.
 */

const EMPTY: readonly SessionDraft[] = Object.freeze([]);

let cached: readonly SessionDraft[] | undefined;
const listeners = new Set<() => void>();

function read(): readonly SessionDraft[] {
  try {
    const stored = parseSessionDrafts(window.sessionStorage.getItem(SESSION_DRAFTS_KEY));
    return stored.length === 0 ? EMPTY : stored;
  } catch {
    // Private window, or blocked site data. The delete control disappears;
    // nothing else depends on this.
    return EMPTY;
  }
}

function commit(next: readonly SessionDraft[]): void {
  cached = next.length === 0 ? EMPTY : next;
  try {
    window.sessionStorage.setItem(SESSION_DRAFTS_KEY, serializeSessionDrafts(cached));
  } catch {
    // Still correct for this page; it just will not survive a navigation.
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function getSnapshot(): readonly SessionDraft[] {
  cached ??= read();
  return cached;
}

/** The server renders nothing as "yours" -- it cannot read sessionStorage. */
function getServerSnapshot(): readonly SessionDraft[] {
  return EMPTY;
}

export function useSessionDrafts() {
  const drafts = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

  const remember = useCallback((draft: SessionDraft) => {
    commit(addSessionDraft(cached ?? read(), draft));
  }, []);

  const forget = useCallback((id: string) => {
    commit(removeSessionDraft(cached ?? read(), id));
  }, []);

  const tokenFor = useCallback((id: string) => deleteTokenFor(drafts, id), [drafts]);

  return { drafts, remember, forget, tokenFor };
}
