import { getSupabaseClient } from "@/lib/supabase";
import legacyExecutiveOrders from "@/data/legacy-import/executive-orders.json";
import legacyRescindedPriorOrders from "@/data/legacy-import/rescinded-prior-orders.json";
import legacyAgencyActions from "@/data/legacy-import/agency-actions.json";
import type { AgencyAction, ExecutiveOrder, RescindedPriorOrder } from "@/lib/types";

// Raw shape of a row from the `executive_orders` table (snake_case, per
// supabase/migrations/0001_init.sql).
interface ExecutiveOrderRow {
  id: string;
  eo_number: string | null;
  action_type: string | null;
  title: string;
  federal_register_url: string | null;
  date_signed: string | null;
  date_published: string | null;
  status: ExecutiveOrder["status"];
  agencies_impacted: string[];
  key_dates: ExecutiveOrder["keyDates"];
  subject_area: string[];
  practice_areas: string[];
  industries: string[];
  ai_summary: string | null;
  deliverable: string | null;
  timeline_notes: string | null;
  available_analysis: string | null;
  legal_challenges: ExecutiveOrder["legalChallenges"];
  news_mentions: ExecutiveOrder["newsMentions"];
  manually_edited_fields: string[];
  document_number: string | null;
  applied_correction_document_numbers: string[];
  citation: string | null;
  full_text: string | null;
  source_notes: string | null;
  needs_review: boolean;
  review_reason: string | null;
  federal_register_synced_at: string | null;
  created_at: string;
  updated_at: string;
}

function mapRow(row: ExecutiveOrderRow): ExecutiveOrder {
  return {
    id: row.id,
    eoNumber: row.eo_number ?? undefined,
    actionType: row.action_type ?? undefined,
    title: row.title,
    federalRegisterUrl: row.federal_register_url ?? undefined,
    dateSigned: row.date_signed ?? "",
    datePublished: row.date_published ?? undefined,
    status: row.status,
    agenciesImpacted: row.agencies_impacted ?? [],
    keyDates: row.key_dates ?? [],
    subjectArea: row.subject_area ?? [],
    practiceAreas: row.practice_areas ?? [],
    industries: row.industries ?? [],
    aiSummary: row.ai_summary ?? undefined,
    deliverable: row.deliverable ?? undefined,
    timelineNotes: row.timeline_notes ?? undefined,
    availableAnalysis: row.available_analysis ?? undefined,
    legalChallenges: row.legal_challenges ?? [],
    newsMentions: row.news_mentions ?? [],
    manuallyEditedFields: row.manually_edited_fields ?? [],
    documentNumber: row.document_number ?? undefined,
    appliedCorrectionDocumentNumbers: row.applied_correction_document_numbers ?? [],
    citation: row.citation ?? undefined,
    fullText: row.full_text ?? undefined,
    sourceNotes: row.source_notes ?? undefined,
    ingestionFlagged: row.needs_review,
    ingestionFlagReason: row.review_reason ?? undefined,
    federalRegisterSyncedAt: row.federal_register_synced_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

// The JSON produced by scripts/import_legacy_tracker.py uses `null` for
// absent optional fields (JSON has no `undefined`) — this coerces it to the
// same shape mapRow produces from Supabase, so both paths return identical
// ExecutiveOrder objects.
function normalizeLegacyOrder(raw: (typeof legacyExecutiveOrders)[number]): ExecutiveOrder {
  return {
    ...raw,
    eoNumber: raw.eoNumber ?? undefined,
    actionType: raw.actionType ?? undefined,
    federalRegisterUrl: raw.federalRegisterUrl ?? undefined,
    datePublished: raw.datePublished ?? undefined,
    aiSummary: raw.aiSummary ?? undefined,
    deliverable: raw.deliverable ?? undefined,
    timelineNotes: raw.timelineNotes ?? undefined,
    availableAnalysis: raw.availableAnalysis ?? undefined,
    status: raw.status as ExecutiveOrder["status"],
    legalChallenges: raw.legalChallenges as ExecutiveOrder["legalChallenges"],
  };
}

/**
 * Flags any executive order whose eoNumber is shared with another order in
 * the list — a known data-quality issue inherited from the source
 * spreadsheet (see README "Known data quality issues"), not something to
 * silently trust. Computed fresh on every fetch rather than stored, so it
 * self-corrects once the underlying duplicates are reconciled.
 */
export function flagDuplicateEoNumbers(orders: ExecutiveOrder[]): ExecutiveOrder[] {
  const counts = new Map<string, number>();
  for (const eo of orders) {
    if (eo.eoNumber) counts.set(eo.eoNumber, (counts.get(eo.eoNumber) ?? 0) + 1);
  }
  return orders.map((eo) => {
    if (eo.eoNumber && (counts.get(eo.eoNumber) ?? 0) > 1) {
      return {
        ...eo,
        needsReview: true,
        needsReviewReason: `${eo.eoNumber} appears on more than one record in the source data — likely a data-entry error in the original tracker. Verify against the Federal Register before relying on this number.`,
      };
    }
    return eo;
  });
}

const LOCAL_EXECUTIVE_ORDERS: ExecutiveOrder[] = flagDuplicateEoNumbers(
  (legacyExecutiveOrders as (typeof legacyExecutiveOrders)[number][])
    .map(normalizeLegacyOrder)
    .sort((a, b) => (a.dateSigned < b.dateSigned ? 1 : -1)),
);

/**
 * Fetches all executive orders, newest-signed first.
 *
 * Falls back to the imported legacy tracker data (src/data/legacy-import/,
 * generated by scripts/import_legacy_tracker.py from the firm's original
 * spreadsheet) whenever Supabase isn't configured or the query fails, so the
 * UI has real data to show during local development before a live database
 * is connected.
 */
export async function getExecutiveOrders(): Promise<ExecutiveOrder[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return LOCAL_EXECUTIVE_ORDERS;
  }

  const { data, error } = await supabase
    .from("executive_orders")
    .select("*")
    .order("date_signed", { ascending: false });

  if (error || !data) {
    console.error("Failed to fetch executive orders from Supabase, falling back to local data:", error);
    return LOCAL_EXECUTIVE_ORDERS;
  }

  return flagDuplicateEoNumbers((data as ExecutiveOrderRow[]).map(mapRow));
}

export async function getExecutiveOrderById(id: string): Promise<ExecutiveOrder | null> {
  const orders = await getExecutiveOrders();
  return orders.find((eo) => eo.id === id) ?? null;
}

export const isUsingLocalData = () => getSupabaseClient() === null;

// --- Rescinded prior orders & agency actions -------------------------------
// Supabase-backed once connected (rescinded_prior_orders / agency_actions
// tables); no dedicated UI yet, but the data is imported and available for
// upcoming pages/features.

export async function getRescindedPriorOrders(): Promise<RescindedPriorOrder[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return legacyRescindedPriorOrders as RescindedPriorOrder[];
  }
  const { data, error } = await supabase
    .from("rescinded_prior_orders")
    .select("*")
    .order("date_signed", { ascending: false });
  if (error || !data) {
    console.error("Failed to fetch rescinded prior orders, falling back to local data:", error);
    return legacyRescindedPriorOrders as RescindedPriorOrder[];
  }
  return data as RescindedPriorOrder[];
}

/** Orders needing human attention: the computed duplicate-eoNumber flag, or an ingestion-set flag (corrections blocked by a manual edit, an ambiguous legacy-row match). Powers the Needs Attention page. */
export async function getFlaggedExecutiveOrders(): Promise<ExecutiveOrder[]> {
  const orders = await getExecutiveOrders();
  return orders.filter((eo) => eo.needsReview || eo.ingestionFlagged);
}

export interface IngestionRunSummary {
  id: string;
  runType: string;
  status: string;
  startedAt: string;
  finishedAt: string | null;
  newCount: number;
  updatedCount: number;
  errorMessage: string | null;
}

interface IngestionRunRow {
  id: string;
  run_type: string;
  status: string;
  started_at: string;
  finished_at: string | null;
  new_count: number;
  updated_count: number;
  error_message: string | null;
}

/** Most recent ingestion_runs entries, newest first. Empty (not an error) when Supabase isn't configured — there's nothing to log against local JSON data. */
export async function getRecentIngestionRuns(limit = 20): Promise<IngestionRunSummary[]> {
  const supabase = getSupabaseClient();
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id, run_type, status, started_at, finished_at, new_count, updated_count, error_message")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error || !data) {
    console.error("Failed to fetch ingestion runs:", error);
    return [];
  }

  return (data as IngestionRunRow[]).map((row) => ({
    id: row.id,
    runType: row.run_type,
    status: row.status,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
    newCount: row.new_count,
    updatedCount: row.updated_count,
    errorMessage: row.error_message,
  }));
}

export async function getAgencyActions(): Promise<AgencyAction[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return legacyAgencyActions as AgencyAction[];
  }
  const { data, error } = await supabase
    .from("agency_actions")
    .select("*")
    .order("key_date", { ascending: false });
  if (error || !data) {
    console.error("Failed to fetch agency actions, falling back to local data:", error);
    return legacyAgencyActions as AgencyAction[];
  }
  return data as AgencyAction[];
}
