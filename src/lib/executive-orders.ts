import { getSupabaseClient } from "@/lib/supabase";
import legacyExecutiveOrders from "@/data/legacy-import/executive-orders.json";
import type { ExecutiveOrder, ExecutiveOrderListItem } from "@/lib/types";
import {
  applyDuplicateFlag,
  flagDuplicateEoNumbers,
} from "@/lib/duplicate-eo-numbers";

// Re-exported so existing `@/lib/data` and test imports keep working after
// the split (see duplicate-eo-numbers.ts for why it moved).
export { flagDuplicateEoNumbers };

// Raw shape of a full row from the `executive_orders` table (snake_case,
// per supabase/migrations/0001_init.sql). Used only where the caller needs
// every column, e.g. the EO detail page and content generation's quote
// verification against full_text.
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

// Columns actually rendered by the tracker table, draft picker, and Needs
// Attention page (verified against src/components/eo-table.tsx's rendered
// cells and its search haystack, which includes ai_summary). Deliberately
// excludes full_text/source_notes — see ExecutiveOrderListItem.
const LIST_COLUMNS =
  "id, eo_number, action_type, title, date_signed, status, subject_area, practice_areas, industries, legal_challenges, needs_review, review_reason, ai_summary";

interface ExecutiveOrderListRow {
  id: string;
  eo_number: string | null;
  action_type: string | null;
  title: string;
  date_signed: string | null;
  status: ExecutiveOrder["status"];
  subject_area: string[];
  practice_areas: string[];
  industries: string[];
  legal_challenges: ExecutiveOrder["legalChallenges"];
  needs_review: boolean;
  review_reason: string | null;
  ai_summary: string | null;
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

function mapListRow(row: ExecutiveOrderListRow): ExecutiveOrderListItem {
  return {
    id: row.id,
    eoNumber: row.eo_number ?? undefined,
    actionType: row.action_type ?? undefined,
    title: row.title,
    dateSigned: row.date_signed ?? "",
    status: row.status,
    subjectArea: row.subject_area ?? [],
    practiceAreas: row.practice_areas ?? [],
    industries: row.industries ?? [],
    legalChallenges: row.legal_challenges ?? [],
    ingestionFlagged: row.needs_review,
    ingestionFlagReason: row.review_reason ?? undefined,
    aiSummary: row.ai_summary ?? undefined,
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

const LOCAL_EXECUTIVE_ORDERS: ExecutiveOrder[] = flagDuplicateEoNumbers(
  (legacyExecutiveOrders as (typeof legacyExecutiveOrders)[number][])
    .map(normalizeLegacyOrder)
    .sort((a, b) => (a.dateSigned < b.dateSigned ? 1 : -1)),
);

/**
 * Fetches the list-shaped columns of every executive order, newest-signed
 * first — powers the tracker table, the draft picker, and (via
 * getFlaggedExecutiveOrders) the Needs Attention page. Deliberately excludes
 * full_text/source_notes: those two columns alone are ~79% of a full-row
 * fetch's payload and none of these consumers render them (see README
 * "Payload size").
 *
 * Falls back to the imported legacy tracker data (src/data/legacy-import/,
 * generated by scripts/import_legacy_tracker.py from the firm's original
 * spreadsheet) whenever Supabase isn't configured or the query fails, so the
 * UI has real data to show during local development before a live database
 * is connected.
 */
export async function getExecutiveOrders(
  supabase = getSupabaseClient(),
): Promise<ExecutiveOrderListItem[]> {
  if (!supabase) {
    return LOCAL_EXECUTIVE_ORDERS;
  }

  const { data, error } = await supabase
    .from("executive_orders")
    .select(LIST_COLUMNS)
    .order("date_signed", { ascending: false });

  if (error || !data) {
    console.error("Failed to fetch executive orders from Supabase, falling back to local data:", error);
    return LOCAL_EXECUTIVE_ORDERS;
  }

  return flagDuplicateEoNumbers((data as unknown as ExecutiveOrderListRow[]).map(mapListRow));
}

/**
 * Fetches one executive order by id, full columns included (full_text and
 * all) — for the EO detail page. Queries that one row directly rather than
 * fetching every order and filtering, which used to be this function's
 * entire implementation.
 */
export async function getExecutiveOrderById(
  id: string,
  supabase = getSupabaseClient(),
): Promise<ExecutiveOrder | null> {
  if (!supabase) {
    return LOCAL_EXECUTIVE_ORDERS.find((eo) => eo.id === id) ?? null;
  }

  const { data, error } = await supabase
    .from("executive_orders")
    .select("*")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error(`Failed to fetch executive order ${id} from Supabase, falling back to local data:`, error);
    return LOCAL_EXECUTIVE_ORDERS.find((eo) => eo.id === id) ?? null;
  }
  if (!data) return null;

  const eo = mapRow(data as ExecutiveOrderRow);
  return applyDuplicateFlag(supabase, eo);
}

/**
 * Fetches full-column rows for exactly the given ids — for content
 * generation, which reads fullText to verify quoted material against
 * source text (see content-generation.ts). Only ever needs the orders a
 * user selected, not the whole table.
 */
export async function getExecutiveOrdersByIds(
  ids: string[],
  supabase = getSupabaseClient(),
): Promise<ExecutiveOrder[]> {
  if (ids.length === 0) return [];

  if (!supabase) {
    return LOCAL_EXECUTIVE_ORDERS.filter((eo) => ids.includes(eo.id));
  }

  const { data, error } = await supabase.from("executive_orders").select("*").in("id", ids);

  if (error || !data) {
    console.error("Failed to fetch executive orders by id from Supabase, falling back to local data:", error);
    return LOCAL_EXECUTIVE_ORDERS.filter((eo) => ids.includes(eo.id));
  }

  return (data as ExecutiveOrderRow[]).map(mapRow);
}

/** Orders needing human attention: the computed duplicate-eoNumber flag, or an ingestion-set flag (corrections blocked by a manual edit, an ambiguous legacy-row match). Powers the Needs Attention page. */
export async function getFlaggedExecutiveOrders(
  supabase = getSupabaseClient(),
): Promise<ExecutiveOrderListItem[]> {
  const orders = await getExecutiveOrders(supabase);
  return orders.filter((eo) => eo.needsReview || eo.ingestionFlagged);
}
