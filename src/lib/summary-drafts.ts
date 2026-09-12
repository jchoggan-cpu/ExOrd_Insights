import { getSupabaseClient } from "@/lib/supabase";
import type { Deliverable } from "@/lib/federal-register/summarize";

/**
 * Reads AI draft summaries (table `summary_drafts`, migration 0005) — the
 * "draft alongside, don't overwrite" half of the summarization work. A draft
 * is never shown as the order's summary; it's shown next to it so a person
 * can compare the two and decide.
 */

export interface SummaryDraft {
  summary: string;
  subjectArea: string[];
  practiceAreas: string[];
  industries: string[];
  deliverables: Deliverable[] | null;
  model: string;
  /** Quoted text not found verbatim in the order's full_text — shown as a warning, not hidden. */
  unverifiedQuotes: string[];
  createdAt: string;
}

export async function getSummaryDraft(executiveOrderId: string): Promise<SummaryDraft | null> {
  const supabase = getSupabaseClient();
  if (!supabase) return null;

  const { data, error } = await supabase
    .from("summary_drafts")
    .select("summary, subject_area, practice_areas, industries, deliverables, model, unverified_quotes, created_at")
    .eq("executive_order_id", executiveOrderId)
    .maybeSingle();

  if (error) {
    // A missing draft is the normal case and must not break the page, but a
    // failed read is not the same thing as "no draft" — say so in the logs
    // rather than letting the section silently disappear (rule 4).
    console.error(`Failed to load the summary draft for ${executiveOrderId}:`, error);
    return null;
  }

  if (!data) return null;

  return {
    summary: data.summary as string,
    subjectArea: (data.subject_area as string[]) ?? [],
    practiceAreas: (data.practice_areas as string[]) ?? [],
    industries: (data.industries as string[]) ?? [],
    deliverables: (data.deliverables as Deliverable[] | null) ?? null,
    model: data.model as string,
    unverifiedQuotes: (data.unverified_quotes as string[]) ?? [],
    createdAt: data.created_at as string,
  };
}
