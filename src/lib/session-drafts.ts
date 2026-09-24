/**
 * The drafts this browser session created, and the token that lets it delete
 * each one.
 *
 * Saving is automatic and drafts are anonymous, so "yours" cannot mean an
 * account -- it means this tab generated it and still holds the capability
 * to remove it. Kept in sessionStorage rather than component state so the
 * delete control survives a page change within the session, the same
 * reasoning as the tracker's order selection.
 *
 * The consequence is deliberate and recorded in the README: close the tab
 * and the token is gone, so an anonymous draft nobody can claim can only be
 * removed from the gated admin list.
 *
 * Pure -- no storage calls, no React -- so the awkward parts are tested
 * without a browser.
 */

export const SESSION_DRAFTS_KEY = "eo-tracker:session-drafts";

export interface SessionDraft {
  id: string;
  /** Proof this session created the draft. Never appears in any listing. */
  deleteToken: string;
}

export function serializeSessionDrafts(drafts: readonly SessionDraft[]): string {
  return JSON.stringify(drafts);
}

/**
 * Tolerant of anything: sessionStorage is editable by hand and survives a
 * format change. Junk becomes an empty list -- the reader loses a delete
 * button, which is far better than a throw on every render of the page.
 */
export function parseSessionDrafts(raw: string | null): SessionDraft[] {
  if (!raw) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    // Not JSON. Nothing to recover and nothing worth reporting.
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set<string>();
  const drafts: SessionDraft[] = [];
  for (const entry of parsed) {
    if (typeof entry !== "object" || entry === null) continue;
    const { id, deleteToken } = entry as Record<string, unknown>;
    if (typeof id !== "string" || !id) continue;
    if (typeof deleteToken !== "string" || !deleteToken) continue;
    if (seen.has(id)) continue;
    seen.add(id);
    drafts.push({ id, deleteToken });
  }
  return drafts;
}

export function addSessionDraft(
  drafts: readonly SessionDraft[],
  draft: SessionDraft,
): SessionDraft[] {
  return [...drafts.filter((d) => d.id !== draft.id), draft];
}

export function removeSessionDraft(drafts: readonly SessionDraft[], id: string): SessionDraft[] {
  return drafts.filter((d) => d.id !== id);
}

/** The token for a draft this session made, or null if it did not make it. */
export function deleteTokenFor(drafts: readonly SessionDraft[], id: string): string | null {
  return drafts.find((d) => d.id === id)?.deleteToken ?? null;
}
