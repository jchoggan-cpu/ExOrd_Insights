import Anthropic from "@anthropic-ai/sdk";
import type { SupabaseClient } from "@supabase/supabase-js";
import { getConfiguredModel } from "@/lib/ai-model";
import { formatError } from "@/lib/format-error";
import { ENRICH_BATCH_SIZE } from "@/lib/federal-register/constants";
import { finishRunSafely, startRun } from "@/lib/federal-register/ingestion-run";
import { findUnverifiedQuotes } from "@/lib/federal-register/quote-verify";
import { summarizeDocument } from "@/lib/federal-register/summarize";

interface EnrichableRow {
  id: string;
  title: string;
  action_type: string | null;
  full_text: string | null;
  manually_edited_fields: string[];
}

// Maps each AI-generated column this job can write to the camelCase name
// manually_edited_fields uses (matching CORRECTION_TOUCHES_FIELDS's
// convention in sync.ts) — so a field an admin has manually corrected is
// never silently overwritten, per the migration's own documented invariant
// (see the executive_orders comment in supabase/migrations/0001_init.sql).
const ENRICHABLE_FIELDS = {
  ai_summary: "aiSummary",
  subject_area: "subjectArea",
  practice_areas: "practiceAreas",
  industries: "industries",
} as const;

export interface JobResult {
  runId: string;
  status: "success" | "partial" | "failure";
  updatedCount: number;
  flaggedCount: number;
  errorMessage?: string;
}

/**
 * Decoupled from ingestion entirely — its own schedule, its own cost. Reads
 * ENRICH_BATCH_SIZE rows missing ai_summary, summarizes+tags each with one
 * model call, and verifies any quoted material against the row's own
 * full_text (a code check, not a prompt instruction) before saving. A
 * summary with an unverifiable quote is never saved — the row is flagged
 * for review instead, since a retry can't fix a hallucination.
 *
 * `anthropicClient` is injectable (rule 3) — the cron route omits it and
 * gets a real client; tests inject a fake instead of making a real
 * Anthropic API call. Constructed inside the try below rather than as a
 * default parameter value, since a default is evaluated before the body
 * runs: were a future SDK version to validate credentials eagerly at
 * construction, that throw would escape past startRun/finishRun and leave
 * the failure unrecorded in ingestion_runs instead of logged.
 */
export async function runEnrichJob(
  supabase: SupabaseClient,
  anthropicClient?: Anthropic,
): Promise<JobResult> {
  const runId = await startRun(supabase, "federal_register_enrichment");

  try {
    const { data, error } = await supabase
      .from("executive_orders")
      .select("id, title, action_type, full_text, manually_edited_fields")
      .is("ai_summary", null)
      .not("full_text", "is", null)
      .limit(ENRICH_BATCH_SIZE);
    if (error) throw new Error(`Failed to load rows needing enrichment: ${error.message}`);

    const rows = (data ?? []) as EnrichableRow[];
    const client = anthropicClient ?? new Anthropic();
    const model = getConfiguredModel();

    let updatedCount = 0;
    let flaggedCount = 0;
    const errors: string[] = [];

    for (const row of rows) {
      try {
        if (!row.full_text) continue; // satisfies TypeScript; excluded by the query above already
        const result = await summarizeDocument(client, model, {
          title: row.title,
          actionType: row.action_type ?? "Executive Order",
          fullText: row.full_text,
        });

        const unverified = findUnverifiedQuotes(result.summary, row.full_text);
        if (unverified.length > 0) {
          const { error: flagError } = await supabase
            .from("executive_orders")
            .update({
              needs_review: true,
              review_reason: `AI summary contained a quote not found verbatim in the stored full text: "${unverified[0]}"`,
            })
            .eq("id", row.id);
          if (flagError) throw new Error(flagError.message);
          flaggedCount++;
          continue;
        }

        const manuallyEdited = new Set(row.manually_edited_fields ?? []);
        const candidateUpdate = {
          ai_summary: result.summary,
          subject_area: result.subjectArea,
          practice_areas: result.practiceAreas,
          industries: result.industries,
        };
        const update = Object.fromEntries(
          Object.entries(candidateUpdate).filter(
            ([column]) => !manuallyEdited.has(ENRICHABLE_FIELDS[column as keyof typeof ENRICHABLE_FIELDS]),
          ),
        );

        const { error: updateError } = await supabase.from("executive_orders").update(update).eq("id", row.id);
        if (updateError) throw new Error(updateError.message);
        updatedCount++;
      } catch (err) {
        errors.push(`${row.id}: ${formatError(err)}`);
      }
    }

    const status = errors.length > 0 ? "partial" : "success";
    const errorMessage = errors.length > 0 ? errors.join("; ") : undefined;
    await finishRunSafely(supabase, runId, { status, newCount: 0, updatedCount, errorMessage });

    return { runId, status, updatedCount, flaggedCount, errorMessage };
  } catch (err) {
    const errorMessage = formatError(err);
    await finishRunSafely(supabase, runId, { status: "failure", newCount: 0, updatedCount: 0, errorMessage });
    return { runId, status: "failure", updatedCount: 0, flaggedCount: 0, errorMessage };
  }
}
