import type Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnthropicClient, getSummaryModel } from "@/lib/ai-model";
import { loadActiveSummaryPrompt } from "@/lib/summary-prompt/store";
import { renderSummaryPrompt } from "@/lib/summary-prompt/render";
import { summarizeDocument } from "@/lib/federal-register/summarize";
import { findUnverifiedQuotes } from "@/lib/federal-register/quote-verify";
import { formatError } from "@/lib/format-error";
import { recordApiUsage } from "@/lib/usage/record";

/**
 * Writes AI draft summaries for rows that ALREADY have a summary — the 338
 * the firm wrote by hand — into `summary_drafts`, leaving `ai_summary`
 * untouched.
 *
 * This is the "draft alongside, don't overwrite" path: those curated
 * summaries are the source the active prompt was distilled from, so a
 * machine pass must not silently replace them. The draft sits next to the
 * curated text on the EO detail page for a person to compare and promote.
 *
 * Unlike the nightly enrich job this has no ingestion_runs bookkeeping: it's
 * run by hand from `npm run draft:summaries`, reports to stdout, and is
 * meant to be watched rather than scheduled.
 */

export interface DraftJobResult {
  attempted: number;
  written: number;
  /** Drafts saved carrying a quote absent from the source text — kept, flagged, never published. */
  flaggedQuoteCount: number;
  errors: string[];
}

interface DraftableRow {
  id: string;
  title: string;
  action_type: string | null;
  full_text: string | null;
}

export interface RunDraftJobOptions {
  /** Injectable for tests (rule 3); the script omits it and gets a real client. */
  anthropicClient?: Anthropic;
  /** How many rows to draft in one pass — these cost real money, so the caller always chooses. */
  limit: number;
  /** Called after each row so a long local run shows progress instead of sitting silent. */
  onProgress?: (done: number, total: number, title: string) => void;
  /** Redraft rows that already have a draft (default: skip them and move down the backlog). */
  redraft?: boolean;
}

export async function runDraftJob(
  supabase: SupabaseClient,
  { anthropicClient, limit, onProgress, redraft = false }: RunDraftJobOptions,
): Promise<DraftJobResult> {
  // Rows already drafted are skipped so repeated runs walk forward through
  // the backlog. Without this, `--limit 10` run five times would re-draft
  // whichever ten rows Postgres happened to return first — reporting ten
  // successes each time while never reaching the rest, and spending real
  // money doing it.
  const { data: drafted, error: draftedError } = await supabase
    .from("summary_drafts")
    .select("executive_order_id");
  if (draftedError) {
    throw new Error(`Failed to load existing drafts: ${draftedError.message}`);
  }
  const alreadyDrafted = new Set((drafted ?? []).map((d) => d.executive_order_id as string));

  const { data, error } = await supabase
    .from("executive_orders")
    .select("id, title, action_type, full_text")
    .not("ai_summary", "is", null)
    .not("full_text", "is", null)
    .order("date_signed", { ascending: false });

  if (error) throw new Error(`Failed to load rows to draft: ${error.message}`);

  const rows = ((data ?? []) as DraftableRow[])
    .filter((row) => redraft || !alreadyDrafted.has(row.id))
    .slice(0, limit);
  const client = anthropicClient ?? createAnthropicClient();
  const model = getSummaryModel();
  const activePrompt = await loadActiveSummaryPrompt(supabase);
  const systemPrompt = renderSummaryPrompt(activePrompt.body);

  const result: DraftJobResult = {
    attempted: rows.length,
    written: 0,
    flaggedQuoteCount: 0,
    errors: [],
  };

  for (const [index, row] of rows.entries()) {
    try {
      if (!row.full_text) continue; // satisfies TypeScript; excluded by the query above already

      const { result: summary, usage } = await summarizeDocument({
        client,
        model,
        systemPrompt,
        input: {
          title: row.title,
          actionType: row.action_type ?? "Executive Order",
          fullText: row.full_text,
        },
      });

      await recordApiUsage(supabase, { feature: "draft", model, usage });

      const unverifiedQuotes = findUnverifiedQuotes(summary.summary, row.full_text);
      if (unverifiedQuotes.length > 0) result.flaggedQuoteCount++;

      await saveDraft(supabase, {
        executive_order_id: row.id,
        summary: summary.summary,
        subject_area: summary.subjectArea,
        practice_areas: summary.practiceAreas,
        industries: summary.industries,
        deliverables: summary.deliverables,
        model,
        summary_prompt_id: activePrompt.id,
        unverified_quotes: unverifiedQuotes,
      });

      result.written++;
      onProgress?.(index + 1, rows.length, row.title);
    } catch (err) {
      result.errors.push(`${row.id}: ${formatError(err)}`);
    }
  }

  return result;
}

/**
 * Replaces this order's draft if it already has one. Read-then-write rather
 * than an upsert so the unique index on executive_order_id stays a backstop
 * against duplicates rather than the mechanism relied on.
 */
async function saveDraft(supabase: SupabaseClient, draft: Record<string, unknown>): Promise<void> {
  const { data: existing, error: readError } = await supabase
    .from("summary_drafts")
    .select("id")
    .eq("executive_order_id", draft.executive_order_id)
    .maybeSingle();

  if (readError) throw new Error(`Failed to check for an existing draft: ${readError.message}`);

  if (existing) {
    const { error } = await supabase
      .from("summary_drafts")
      .update({ ...draft, created_at: new Date().toISOString() })
      .eq("id", existing.id);
    if (error) throw new Error(`Failed to replace the existing draft: ${error.message}`);
    return;
  }

  const { error } = await supabase.from("summary_drafts").insert(draft);
  if (error) throw new Error(`Failed to save the draft: ${error.message}`);
}
