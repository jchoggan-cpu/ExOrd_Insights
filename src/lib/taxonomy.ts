import practiceAreasData from "@/config/practice-areas.json";
import industriesData from "@/config/industries.json";
import subjectAreasData from "@/config/subject-areas.json";

export interface PracticeArea {
  name: string;
  /** One-line guidance shown to the model for when this group should be selected (see src/config/practice-areas.json). */
  criteria?: string;
  subPractices?: string[];
}

// Sheppard's fixed Practice Areas list (see src/config/practice-areas.json).
// Swap the JSON file's contents if the firm's list changes — nothing else
// needs to change.
export const PRACTICE_AREAS: PracticeArea[] = practiceAreasData;

export const PRACTICE_AREA_NAMES: string[] = PRACTICE_AREAS.map((p) => p.name);

// Sheppard's fixed Industries list (see src/config/industries.json).
export const INDUSTRIES: string[] = industriesData;

// The firm's Subject Area topics (see src/config/subject-areas.json), derived
// from the 26 values actually used across the 340 hand-curated rows of the
// original tracker spreadsheet, ordered by how often the firm used each.
// Previously the model invented its own tags; validating against this list
// instead keeps the column filterable.
export const SUBJECT_AREAS: string[] = subjectAreasData;
