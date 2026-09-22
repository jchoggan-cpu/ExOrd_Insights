/**
 * How a stored tag is written on screen.
 *
 * A practice-area subgroup is stored as "Governmental--National Security"
 * so migration 0008 can match a selected parent against its subgroups by
 * splitting on the separator. That separator is a storage detail: rendered
 * raw it reads as a typo, and it was visible on the tracker's pills and in
 * the mockup's own screenshots.
 *
 * Pure and shared, so a pill and a filter chip can never disagree about how
 * the same tag is spelled.
 */

/** Separator between a practice area and one of its subgroups. See migration 0008. */
export const SUBGROUP_SEPARATOR = "--";

export function formatTagLabel(tag: string): string {
  return tag.split(SUBGROUP_SEPARATOR).join(" \u2013 ");
}
