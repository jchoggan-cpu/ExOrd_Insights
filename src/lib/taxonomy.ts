import practiceAreasData from "@/config/practice-areas.json";
import industriesData from "@/config/industries.json";
import subjectAreasData from "@/config/subject-areas.json";

export interface PracticeArea {
  name: string;
  /** One-line guidance shown to the model for when this group should be selected (see src/config/practice-areas.json). */
  criteria?: string;
  /**
   * Subgroups within this practice, in the same shape as the parent so one
   * type serves both levels. A subgroup is only offered to the classifier —
   * and only accepted back from it — when it carries its own `criteria`,
   * which is what keeps a merely-listed subgroup from becoming a tag nobody
   * wrote guidance for.
   */
  subPractices?: PracticeArea[];
}

/**
 * Separates a parent practice from its subgroup in a stored tag, as in
 * "Governmental--National Security".
 *
 * Kept as one character sequence in one place because it is load-bearing in
 * three: the tag written to the database, the value validated on the way
 * back, and the prefix a filter matches on to find every subgroup of a
 * parent at once.
 */
export const SUBPRACTICE_SEPARATOR = "--";

/** Builds the stored tag for a subgroup, e.g. "Governmental--National Security". */
export function subPracticeTag(parent: string, subPractice: string): string {
  return `${parent}${SUBPRACTICE_SEPARATOR}${subPractice}`;
}

/** The parent practice of a tag, whether or not it names a subgroup. */
export function parentPracticeOf(tag: string): string {
  const at = tag.indexOf(SUBPRACTICE_SEPARATOR);
  return at === -1 ? tag : tag.slice(0, at);
}

// Sheppard's fixed Practice Areas list (see src/config/practice-areas.json).
// Swap the JSON file's contents if the firm's list changes — nothing else
// needs to change.
export const PRACTICE_AREAS: PracticeArea[] = practiceAreasData;

export const PRACTICE_AREA_NAMES: string[] = PRACTICE_AREAS.map((p) => p.name);

/**
 * Practice areas that have subgroups worth offering to the classifier —
 * those whose subgroups carry their own criteria.
 */
export const PRACTICE_AREAS_WITH_SUBPRACTICES: PracticeArea[] = PRACTICE_AREAS.filter((p) =>
  p.subPractices?.some((sub) => sub.criteria),
);

/**
 * Every tag a row may legitimately carry: each practice area on its own,
 * plus "Parent--Subgroup" for every subgroup that has criteria.
 *
 * A bare parent stays valid alongside its subgroups on purpose — an order
 * can be Governmental without fitting any one subgroup, and forcing a
 * subgroup would mean recording a guess.
 */
export const PRACTICE_AREA_TAGS: string[] = [
  ...PRACTICE_AREA_NAMES,
  ...PRACTICE_AREAS_WITH_SUBPRACTICES.flatMap((parent) =>
    (parent.subPractices ?? []).filter((sub) => sub.criteria).map((sub) => subPracticeTag(parent.name, sub.name)),
  ),
];

// Sheppard's fixed Industries list (see src/config/industries.json).
export const INDUSTRIES: string[] = industriesData;

// The firm's Subject Area topics (see src/config/subject-areas.json), derived
// from the 26 values actually used across the 340 hand-curated rows of the
// original tracker spreadsheet, ordered by how often the firm used each.
// Previously the model invented its own tags; validating against this list
// instead keeps the column filterable.
export const SUBJECT_AREAS: string[] = subjectAreasData;
