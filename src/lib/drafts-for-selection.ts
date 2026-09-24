import type { SharedDraft } from "@/lib/content-drafts";

/**
 * Which already-written drafts cover the orders a reader has just ticked.
 *
 * Pure, and separate from the query, so the drafter can answer "somebody has
 * already written this" as the selection changes without a round trip -- and
 * so the matching is tested without a database.
 */
export function draftsForSelection(
  drafts: readonly SharedDraft[],
  selectedIds: readonly string[],
): SharedDraft[] {
  if (selectedIds.length === 0) return [];
  const wanted = new Set(selectedIds);
  // Overlap, not containment: a digest covering four orders is relevant to
  // someone about to write about one of them.
  return drafts.filter((draft) => draft.eoIds.some((id) => wanted.has(id)));
}

/**
 * The same, narrowed to one content type -- "there is already a client alert
 * about this" is a much stronger warning than "there is already something".
 */
export function draftsMatchingType(
  drafts: readonly SharedDraft[],
  selectedIds: readonly string[],
  contentType: string,
): SharedDraft[] {
  return draftsForSelection(drafts, selectedIds).filter((d) => d.contentType === contentType);
}
