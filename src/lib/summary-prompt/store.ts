import type { SupabaseClient } from "@supabase/supabase-js";
import { DEFAULT_SUMMARY_PROMPT } from "@/lib/summary-prompt/default-prompt";
import { validateSummaryPrompt } from "@/lib/summary-prompt/render";

/**
 * Reads and writes the editable summarization prompt (table `summary_prompts`,
 * migration 0005). The client is passed in rather than imported (rule 3) —
 * the app's pages read it through the anon client, the enrich job and the
 * save route through the service-role client, and tests through a fake.
 */

export interface ActiveSummaryPrompt {
  /** Null when no prompt has been saved yet and the built-in default is in use. */
  id: string | null;
  body: string;
  isDefault: boolean;
}

export interface SummaryPromptVersion {
  id: string;
  body: string;
  note: string | null;
  isActive: boolean;
  createdAt: string;
}

/** How many past versions the /prompt page shows. Enough to undo a bad edit, not a full audit log. */
export const PROMPT_HISTORY_LIMIT = 20;

/**
 * The prompt the pipeline should use right now.
 *
 * A failed read throws rather than quietly returning the default: silently
 * summarizing 20 rows a night with a prompt nobody chose is exactly the kind
 * of invisible failure rule 4 exists to prevent. The enrich job catches it
 * and records the failure against its ingestion_runs row.
 */
export async function loadActiveSummaryPrompt(
  supabase: SupabaseClient,
): Promise<ActiveSummaryPrompt> {
  const { data, error } = await supabase
    .from("summary_prompts")
    .select("id, body")
    .eq("is_active", true)
    .maybeSingle();

  if (error) {
    throw new Error(`Failed to load the active summarization prompt: ${error.message}`);
  }

  if (!data) {
    return { id: null, body: DEFAULT_SUMMARY_PROMPT, isDefault: true };
  }

  return { id: data.id as string, body: data.body as string, isDefault: false };
}

export async function listSummaryPrompts(
  supabase: SupabaseClient,
  limit: number = PROMPT_HISTORY_LIMIT,
): Promise<SummaryPromptVersion[]> {
  const { data, error } = await supabase
    .from("summary_prompts")
    .select("id, body, note, is_active, created_at")
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Failed to load prompt history: ${error.message}`);
  }

  return (data ?? []).map((row) => ({
    id: row.id as string,
    body: row.body as string,
    note: (row.note as string | null) ?? null,
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as string,
  }));
}

/**
 * Saves a new version and makes it the active one. Previous versions are
 * kept, not overwritten — the point of versioning here is that a prompt edit
 * silently changes every summary written afterwards, so being able to read
 * back what was in force at the time matters.
 *
 * Three writes rather than one transaction (supabase-js has no client-side
 * transaction): insert inactive, deactivate the old, activate the new. The
 * `summary_prompts_one_active` partial unique index is what actually
 * guarantees at most one active row; this ordering just avoids tripping it.
 */
export async function saveSummaryPrompt(
  supabase: SupabaseClient,
  { body, note }: { body: string; note?: string },
): Promise<{ id: string }> {
  const { errors } = validateSummaryPrompt(body);
  if (errors.length > 0) {
    throw new Error(`Refusing to save an unusable prompt: ${errors.join(" ")}`);
  }

  const { data: inserted, error: insertError } = await supabase
    .from("summary_prompts")
    .insert({ body, note: note?.trim() || null, is_active: false })
    .select("id")
    .single();

  if (insertError || !inserted) {
    throw new Error(`Failed to save the prompt: ${insertError?.message ?? "no row returned"}`);
  }

  const newId = inserted.id as string;

  const { error: deactivateError } = await supabase
    .from("summary_prompts")
    .update({ is_active: false })
    .eq("is_active", true);

  if (deactivateError) {
    throw new Error(
      `Saved the new prompt (${newId}) but could not deactivate the previous one: ${deactivateError.message}. The previous prompt is still in force.`,
    );
  }

  const { error: activateError } = await supabase
    .from("summary_prompts")
    .update({ is_active: true })
    .eq("id", newId);

  if (activateError) {
    throw new Error(
      `Saved the new prompt (${newId}) but could not activate it: ${activateError.message}. No prompt is active, so the built-in default is now in force — retry the save.`,
    );
  }

  return { id: newId };
}
