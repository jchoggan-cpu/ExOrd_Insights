import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * How an order is named when it is referred to from somewhere else -- a
 * shared draft, say, which stores only ids.
 *
 * Its own module because the alternative was a `select *` through the
 * ordinary data layer, which carries full_text: megabytes of statutory text
 * fetched to print "EO 14259" next to a draft title.
 *
 * The client is passed in (rule 3).
 */

export interface OrderLabel {
  id: string;
  /** "EO 14259" where there is a number, the instrument type where there is not. */
  reference: string;
  title: string;
}

export async function listOrderLabels(
  supabase: SupabaseClient,
  ids: string[],
): Promise<Map<string, OrderLabel>> {
  const unique = [...new Set(ids)].filter(Boolean);
  if (unique.length === 0) return new Map();

  const { data, error } = await supabase
    .from("executive_orders")
    .select("id, eo_number, action_type, title")
    .in("id", unique);

  if (error) throw new Error(`Failed to load order labels: ${error.message}`);

  const labels = new Map<string, OrderLabel>();
  for (const row of (data ?? []) as Array<Record<string, string | null>>) {
    labels.set(row.id as string, {
      id: row.id as string,
      reference: row.eo_number ?? row.action_type ?? "Executive action",
      title: row.title ?? "Untitled",
    });
  }
  return labels;
}
