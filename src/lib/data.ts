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

// The client is a defaulted parameter on every read below rather than
// something each one reaches for (rule 3), so a test can hand in a fake
// and exercise the failure paths — which is what these reads get wrong
// when they get anything wrong.
export const isUsingLocalData = () => getSupabaseClient() === null;

// --- Rescinded prior orders & agency actions -------------------------------
// Supabase-backed once connected (rescinded_prior_orders / agency_actions
// tables); no dedicated UI yet, but the data is imported and available for
// upcoming pages/features.

export async function getRescindedPriorOrders(
  supabase = getSupabaseClient(),
): Promise<RescindedPriorOrder[]> {
  if (!supabase) {
    return legacyRescindedPriorOrders as RescindedPriorOrder[];
  }
  const { data, error } = await supabase
    .from("rescinded_prior_orders")
    .select("*")
    .order("date_signed", { ascending: false });
  if (error || !data) {
    // Never the legacy snapshot on a failed query — see getExecutiveOrders.
    console.error("Failed to fetch rescinded prior orders:", error);
    throw new Error(`Failed to fetch rescinded prior orders: ${error?.message ?? "no data returned"}`);
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
export async function getRecentIngestionRuns(
  limit = 20,
  supabase = getSupabaseClient(),
): Promise<IngestionRunSummary[]> {
  if (!supabase) return [];

  const { data, error } = await supabase
    .from("ingestion_runs")
    .select("id, run_type, status, started_at, finished_at, new_count, updated_count, error_message")
    .order("started_at", { ascending: false })
    .limit(limit);
  if (error || !data) {
    // An empty list here reads as "nothing has ever run", which is the
    // opposite of what a failed query means — and it would say it on the one
    // page someone opens to check whether the pipeline is alive.
    console.error("Failed to fetch ingestion runs:", error);
    throw new Error(`Failed to fetch ingestion runs: ${error?.message ?? "no data returned"}`);
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

export async function getAgencyActions(
  supabase = getSupabaseClient(),
): Promise<AgencyAction[]> {
  if (!supabase) {
    return legacyAgencyActions as AgencyAction[];
  }
  const { data, error } = await supabase
    .from("agency_actions")
    .select("*")
    .order("key_date", { ascending: false });
  if (error || !data) {
    // Never the legacy snapshot on a failed query — see getExecutiveOrders.
    console.error("Failed to fetch agency actions:", error);
    throw new Error(`Failed to fetch agency actions: ${error?.message ?? "no data returned"}`);
  }
  return data as AgencyAction[];
}
