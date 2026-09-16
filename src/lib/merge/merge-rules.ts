/**
 * Deciding which side of a duplicate pair wins each field.
 *
 * Neither row is complete on its own — verified across all 62 pairs: the
 * legacy row is the only side carrying agencies impacted (62/62) and
 * timeline notes (61/62), and the Federal Register row is the only side
 * carrying source text, the official URL, the FR citation, publication date
 * and document number (62/62 each). So this is a merge, never a delete of
 * one side.
 *
 * Every rule below is "prefer this side, fall back to the other if it has
 * nothing" — which is what resolves the handful of one-off cases (3
 * deliverables that exist only on the Federal Register side, 1 practice area
 * and 1 industry that exist only on the legacy side).
 */

import type { DuplicatePair, OrderRow } from "@/lib/merge/duplicate-pairs";

export type Side = "legacy" | "federalRegister";

/**
 * The summary field is the one deliberate inversion of the firm-curated
 * rule, decided 2026-09-16: the Federal Register row's AI summary wins over
 * the firm's hand-written one.
 *
 * Nothing is lost by it — all 62 of the firm's summaries are preserved in
 * data/original-summaries-snapshot.json, committed to the repo. The tradeoff
 * accepted is house style: the AI summaries run a median of 98 words against
 * the firm's 52, so these rows read longer than the rest of the tracker.
 */
export const AI_SUMMARY_WINNER: Side = "federalRegister";

/**
 * Which side owns each column.
 *
 * The firm-curated group is not a judgement call: every one of the 62 legacy
 * rows carries the identical manually_edited_fields list
 * ["aiSummary","availableAnalysis","deliverable","legalChallenges",
 * "subjectArea","timelineNotes"], and every Federal Register row carries an
 * empty one. Note what is absent from that list — practice_areas and
 * industries were never curated by anyone, which is why the newer machine
 * pass wins them.
 */
export const FIELD_PREFERENCE: Record<string, Side> = {
  // --- Written by the firm -------------------------------------------------
  subject_area: "legacy",
  deliverable: "legacy",
  timeline_notes: "legacy",
  available_analysis: "legacy",
  legal_challenges: "legacy",
  // Not curated, but only the legacy side ever has them.
  agencies_impacted: "legacy",
  key_dates: "legacy",
  news_mentions: "legacy",

  // --- Provenance: only the ingested row has any of these ------------------
  document_number: "federalRegister",
  applied_correction_document_numbers: "federalRegister",
  citation: "federalRegister",
  full_text: "federalRegister",
  federal_register_url: "federalRegister",
  date_published: "federalRegister",
  eo_number: "federalRegister",
  source_notes: "federalRegister",
  federal_register_synced_at: "federalRegister",
  // The Federal Register tracks disposition; the spreadsheet stopped being
  // maintained in January 2026, so its "active" can be stale where the
  // Federal Register says "revoked".
  status: "federalRegister",

  // The Federal Register is authoritative on what kind of instrument this
  // is, and the spreadsheet is measurably not: across the 62 pairs its
  // action_type disagrees 6 times and is wrong all 6. Four are the stale
  // placeholder "Pending Federal Register Publication" — which the existence
  // of a Federal Register row disproves by definition — and two are real
  // misclassifications (the southern-border national emergency and the
  // Auschwitz remembrance day are both proclamations, recorded as memoranda).
  action_type: "federalRegister",

  // --- Machine-generated on both sides; the ingested row is the newer pass --
  practice_areas: "federalRegister",
  industries: "federalRegister",

  ai_summary: AI_SUMMARY_WINNER,
};

/**
 * Columns the merge must never copy between rows: identity, timestamps
 * managed by the database, the generated search vector, and the two flag
 * columns which are resolved by their own rule below.
 */
const NEVER_COPIED = new Set([
  "id",
  "created_at",
  "updated_at",
  "search_vector",
  "title",
  "date_signed",
  "manually_edited_fields",
  "needs_review",
  "review_reason",
]);

/** Empty string and empty array both mean "this side has nothing", the same as null. */
export function isPresent(value: unknown): boolean {
  if (value === null || value === undefined) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === "string") return value.trim() !== "";
  return true;
}

export interface FieldResolution {
  field: string;
  /** Which side supplied the winning value, or "neither" when both were empty. */
  source: Side | "neither";
  value: unknown;
  /** True when both sides held a value and the two disagreed. */
  conflicted: boolean;
  /** The value that lost, present only on a conflict — so the dry run can show both. */
  losingValue?: unknown;
  /**
   * False when FIELD_PREFERENCE says nothing about this column and the
   * fallback was used. Surfaced rather than swallowed: `action_type` was
   * missing from the table on the first run and silently kept the
   * spreadsheet's stale value on 6 rows, which is precisely the kind of
   * quiet default a column added to the schema later would repeat.
   */
  hadExplicitPreference: boolean;
}

export interface MergePlan {
  /** The legacy row's id, which survives: other records already reference it. */
  keepId: string;
  /** The Federal Register row's id, which is deleted once its fields are copied across. */
  deleteId: string;
  title: string;
  dateSigned: string | null;
  /** Exactly the columns whose value changes on the surviving row. */
  updates: Record<string, unknown>;
  resolutions: FieldResolution[];
  conflicts: FieldResolution[];
  /** Columns FIELD_PREFERENCE says nothing about. Non-empty means the rules need updating before applying. */
  unlistedFields: string[];
}

/** Used only when FIELD_PREFERENCE has no entry; the caller reports every field that lands here. */
const UNLISTED_FIELD_FALLBACK: Side = "legacy";

function resolveField(field: string, legacy: unknown, federalRegister: unknown): FieldResolution {
  const hadExplicitPreference = field in FIELD_PREFERENCE;
  const preferred = FIELD_PREFERENCE[field] ?? UNLISTED_FIELD_FALLBACK;
  const preferredValue = preferred === "legacy" ? legacy : federalRegister;
  const otherValue = preferred === "legacy" ? federalRegister : legacy;
  const otherSide: Side = preferred === "legacy" ? "federalRegister" : "legacy";

  const bothPresent = isPresent(legacy) && isPresent(federalRegister);
  const conflicted = bothPresent && JSON.stringify(legacy) !== JSON.stringify(federalRegister);

  if (isPresent(preferredValue)) {
    return {
      field,
      source: preferred,
      value: preferredValue,
      conflicted,
      hadExplicitPreference,
      ...(conflicted ? { losingValue: otherValue } : {}),
    };
  }
  if (isPresent(otherValue)) {
    return { field, source: otherSide, value: otherValue, conflicted: false, hadExplicitPreference };
  }
  return {
    field,
    source: "neither",
    value: preferredValue ?? otherValue ?? null,
    conflicted: false,
    hadExplicitPreference,
  };
}

/**
 * The surviving row keeps the firm's protected-field list minus `aiSummary`.
 *
 * Leaving `aiSummary` in it would tell every later job that an attorney
 * wrote the text now sitting in that column, when the decision above put the
 * model's text there. A Federal Register correction would then refuse to
 * update it, and the row would be frozen under a false label.
 */
export function mergedManuallyEditedFields(legacy: OrderRow): string[] {
  const fields = (legacy.manually_edited_fields as string[] | null) ?? [];
  return AI_SUMMARY_WINNER === "federalRegister"
    ? fields.filter((field) => field !== "aiSummary")
    : [...fields];
}

/** A flag on either side survives the merge — a review reason is never dropped just because the other row was clean. */
function resolveReviewFlag(pair: DuplicatePair): { needs_review: boolean; review_reason: string | null } {
  for (const row of [pair.legacy, pair.federalRegister]) {
    if (row.needs_review === true) {
      return { needs_review: true, review_reason: (row.review_reason as string | null) ?? null };
    }
  }
  return { needs_review: false, review_reason: null };
}

/**
 * Builds the full plan for one pair without touching a database — so the
 * dry run prints exactly what the apply step will do, from the same code.
 */
export function planMerge(pair: DuplicatePair): MergePlan {
  const { legacy, federalRegister } = pair;
  const columns = [...new Set([...Object.keys(legacy), ...Object.keys(federalRegister)])]
    .filter((column) => !NEVER_COPIED.has(column))
    .sort();

  const resolutions = columns.map((column) => resolveField(column, legacy[column], federalRegister[column]));

  const updates: Record<string, unknown> = {};
  for (const resolution of resolutions) {
    if (resolution.source === "neither") continue;
    if (JSON.stringify(resolution.value) === JSON.stringify(legacy[resolution.field])) continue;
    updates[resolution.field] = resolution.value;
  }

  const manuallyEdited = mergedManuallyEditedFields(legacy);
  if (JSON.stringify(manuallyEdited) !== JSON.stringify(legacy.manually_edited_fields ?? [])) {
    updates.manually_edited_fields = manuallyEdited;
  }

  const reviewFlag = resolveReviewFlag(pair);
  if (reviewFlag.needs_review !== (legacy.needs_review === true)) {
    updates.needs_review = reviewFlag.needs_review;
    updates.review_reason = reviewFlag.review_reason;
  }

  return {
    keepId: legacy.id,
    deleteId: federalRegister.id,
    title: legacy.title,
    dateSigned: legacy.date_signed,
    updates,
    resolutions,
    conflicts: resolutions.filter((resolution) => resolution.conflicted),
    unlistedFields: resolutions.filter((r) => !r.hadExplicitPreference).map((r) => r.field),
  };
}
