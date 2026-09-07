import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Returns a Supabase client, or null if NEXT_PUBLIC_SUPABASE_URL /
 * NEXT_PUBLIC_SUPABASE_ANON_KEY aren't set. Callers must handle the null
 * case — src/lib/data.ts falls back to sample data when this is null, which
 * is the expected state until a Supabase project is connected (see README).
 */
export function getSupabaseClient(): SupabaseClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !anonKey) {
    return null;
  }

  return createClient(url, anonKey);
}

/**
 * Returns a service-role Supabase client, which bypasses row-level security
 * — for the Federal Register ingestion pipeline only (cron routes, the
 * backfill script). Unlike getSupabaseClient(), there's no graceful
 * fallback: these jobs have nothing useful to do without a real database,
 * so a missing/misconfigured key should fail loudly, not silently no-op.
 */
export function getServiceRoleClient(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceRoleKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must both be set to run Federal Register ingestion.",
    );
  }

  return createClient(url, serviceRoleKey);
}
