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
