import { getSupabaseClient } from "@/lib/supabase";
import legacyRescindedPriorOrders from "@/data/legacy-import/rescinded-prior-orders.json";
import legacyAgencyActions from "@/data/legacy-import/agency-actions.json";
import type { AgencyAction, RescindedPriorOrder } from "@/lib/types";

// Executive-order reads (list, detail, by-id, flagged) live in
// executive-orders.ts — split out to keep this file under the project's
// 300-line limit and to keep "one job per file" (this file: rescinded prior
// orders, agency actions, and ingestion-run history; that file: executive
// orders themselves). Re-exported here so existing `@/lib/data` imports
// throughout the app don't need to change.
export {
  flagDuplicateEoNumbers,
  getExecutiveOrders,
  getExecutiveOrderById,
  getExecutiveOrdersByIds,
  getFlaggedExecutiveOrders,
} from "@/lib/executive-orders";

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
