import { getSupabaseClient } from "@/lib/supabase";
import { SAMPLE_EXECUTIVE_ORDERS } from "@/data/sample-executive-orders";
import type { ExecutiveOrder } from "@/lib/types";

// Raw shape of a row from the `executive_orders` table (snake_case, per
// supabase/migrations/0001_init.sql).
interface ExecutiveOrderRow {
  id: string;
  eo_number: string;
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
  created_at: string;
  updated_at: string;
}

function mapRow(row: ExecutiveOrderRow): ExecutiveOrder {
  return {
    id: row.id,
    eoNumber: row.eo_number,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Fetches all executive orders, newest-signed first.
 *
 * Falls back to SAMPLE_EXECUTIVE_ORDERS whenever Supabase isn't configured
 * (no env vars) or the query fails, so the UI always has something to show
 * during local development before a real database is connected.
 */
export async function getExecutiveOrders(): Promise<ExecutiveOrder[]> {
  const supabase = getSupabaseClient();
  if (!supabase) {
    return SAMPLE_EXECUTIVE_ORDERS;
  }

  const { data, error } = await supabase
    .from("executive_orders")
    .select("*")
    .order("date_signed", { ascending: false });

  if (error || !data) {
    console.error("Failed to fetch executive orders from Supabase, falling back to sample data:", error);
    return SAMPLE_EXECUTIVE_ORDERS;
  }

  return (data as ExecutiveOrderRow[]).map(mapRow);
}

export async function getExecutiveOrderById(id: string): Promise<ExecutiveOrder | null> {
  const orders = await getExecutiveOrders();
  return orders.find((eo) => eo.id === id) ?? null;
}

export const isUsingSampleData = () => getSupabaseClient() === null;
