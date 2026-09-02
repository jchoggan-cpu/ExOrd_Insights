import practiceAreasData from "@/config/practice-areas.json";
import industriesData from "@/config/industries.json";

export interface PracticeArea {
  name: string;
  subPractices?: string[];
}

// Sheppard's fixed Practice Areas list (see src/config/practice-areas.json).
// Swap the JSON file's contents if the firm's list changes — nothing else
// needs to change.
export const PRACTICE_AREAS: PracticeArea[] = practiceAreasData;

export const PRACTICE_AREA_NAMES: string[] = PRACTICE_AREAS.map((p) => p.name);

// Sheppard's fixed Industries list (see src/config/industries.json).
export const INDUSTRIES: string[] = industriesData;
