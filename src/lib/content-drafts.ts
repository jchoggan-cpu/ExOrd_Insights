import type { SupabaseClient } from "@supabase/supabase-js";
import type { ContentDraft, ContentType } from "@/lib/types";

/**
 * Reading and writing the drafts the team shares.
 *
 * `content_drafts` has existed since migration 0001 and held nothing until
 * now. Its RLS policies were written for Phase 5 accounts -- insert requires
 * `created_by = auth.uid()`, select requires an authenticated role -- and
 * neither can be satisfied while the tracker has no accounts. Rather than
 * relax those policies in a migration, every call here goes through the
 * service-role client from the server, which bypasses RLS. The policies stay
 * as written and correct for the day auth arrives, and the table stays shut
 * to direct anonymous access from the browser in the meantime.
 *
 * The client is passed in (rule 3) so these can be tested against a fake.
 */

/** Columns safe to show anyone. Deliberately not a `select *`: see the note on drafts being shared. */
const LIST_COLUMNS = "id, eo_ids, content_type, title, draft_text, reviewed_at, created_at";

interface DraftRow {
  id: string;
  eo_ids: string[];
  content_type: ContentType;
  title: string | null;
  draft_text: string;
  reviewed_at: string | null;
  created_at: string;
}

/** A shared draft as the UI reads it. `createdBy` is deliberately absent — nothing records it yet. */
export interface SharedDraft extends Omit<ContentDraft, "createdBy"> {
  /** Null until the review gate moves server-side; today every saved draft is unreviewed. */
  reviewedAt?: string;
}

function mapRow(row: DraftRow): SharedDraft {
  return {
    id: row.id,
    eoIds: row.eo_ids ?? [],
    contentType: row.content_type,
    title: row.title ?? undefined,
    draftText: row.draft_text,
    reviewedAt: row.reviewed_at ?? undefined,
    createdAt: row.created_at,
  };
}

/**
 * Stores a freshly generated draft and returns its id.
 *
 * Saving is automatic, so this runs for every generation including ones the
 * author immediately regrets -- which is what the delete control is for.
 *
 * `created_by` is left null on purpose. There is no identity to record, and
 * inventing a placeholder would make the column look answered when it is
 * not.
 */
export async function saveDraft(
  supabase: SupabaseClient,
  draft: { eoIds: string[]; contentType: ContentType; title?: string; draftText: string },
): Promise<string> {
  const { data, error } = await supabase
    .from("content_drafts")
    .insert({
      eo_ids: draft.eoIds,
      content_type: draft.contentType,
      title: draft.title ?? null,
      draft_text: draft.draftText,
    })
    .select("id")
    .single();

  if (error) throw new Error(`Failed to save draft: ${error.message}`);
  return (data as { id: string }).id;
}

/** Newest first. Limited because this is a browsing list, not an export. */
export async function listDrafts(
  supabase: SupabaseClient,
  limit = 100,
): Promise<SharedDraft[]> {
  const { data, error } = await supabase
    .from("content_drafts")
    .select(LIST_COLUMNS)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load drafts: ${error.message}`);
  return ((data ?? []) as unknown as DraftRow[]).map(mapRow);
}

/**
 * Drafts already written about any of these orders.
 *
 * This is what stops the same client alert being generated, and paid for,
 * three times: the drafts are surfaced where the decision is made -- on an
 * order's page and in the drafter -- rather than only on a list somebody has
 * to think to visit.
 *
 * `overlaps` is Postgres array overlap on eo_ids, so a multi-order digest is
 * found by any one of the orders it covers.
 */
export async function listDraftsForOrders(
  supabase: SupabaseClient,
  eoIds: string[],
  limit = 20,
): Promise<SharedDraft[]> {
  if (eoIds.length === 0) return [];

  const { data, error } = await supabase
    .from("content_drafts")
    .select(LIST_COLUMNS)
    .overlaps("eo_ids", eoIds)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) throw new Error(`Failed to load drafts for these orders: ${error.message}`);
  return ((data ?? []) as unknown as DraftRow[]).map(mapRow);
}

/**
 * Removes one draft. The caller is responsible for having established that
 * it may -- either a valid delete token or admin access -- because this
 * runs with the service role and will delete whatever it is given.
 */
export async function deleteDraft(supabase: SupabaseClient, id: string): Promise<void> {
  const { error } = await supabase.from("content_drafts").delete().eq("id", id);
  if (error) throw new Error(`Failed to delete draft: ${error.message}`);
}
