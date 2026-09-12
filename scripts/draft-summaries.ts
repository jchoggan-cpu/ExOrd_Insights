#!/usr/bin/env node
/**
 * Writes AI draft summaries alongside the firm's hand-curated ones, for
 * side-by-side review on each EO's detail page. Never overwrites `ai_summary`.
 *
 * Usage:
 *   npm run draft:summaries                  # dry run — counts what's draftable, calls no model, costs nothing
 *   npm run draft:summaries -- --apply       # drafts DEFAULT_LIMIT rows
 *   npm run draft:summaries -- --apply --limit 50
 *   npm run draft:summaries -- --apply --redraft   # re-draft rows already drafted
 *
 * Deliberately NOT a cron job. Each row is a full-text model call against
 * Fable 5, so the number of rows drafted is always an explicit choice made
 * by a person watching the output, not something that happens overnight.
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, and an AI
 * credential in .env.local (same as scripts/backfill-federal-register.ts).
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { runDraftJob } from "../src/lib/federal-register/draft-job";
import { getServiceRoleClient } from "../src/lib/supabase";
import { getSummaryModel, describeAiProvider, hasAiCredentials } from "../src/lib/ai-model";
import { loadActiveSummaryPrompt } from "../src/lib/summary-prompt/store";

/** Small on purpose: read the first batch's output before spending on the rest. */
const DEFAULT_LIMIT = 10;

function parseLimit(args: string[]): number {
  const flagIndex = args.indexOf("--limit");
  if (flagIndex === -1) return DEFAULT_LIMIT;

  const parsed = Number(args[flagIndex + 1]);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new Error(`--limit needs a positive whole number, got: ${args[flagIndex + 1] ?? "(nothing)"}`);
  }
  return parsed;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const redraft = args.includes("--redraft");
  const limit = parseLimit(args);
  const supabase = getServiceRoleClient();

  const { count, error } = await supabase
    .from("executive_orders")
    .select("id", { count: "exact", head: true })
    .not("ai_summary", "is", null)
    .not("full_text", "is", null);
  if (error) throw new Error(`Failed to count draftable rows: ${error.message}`);

  const activePrompt = await loadActiveSummaryPrompt(supabase);

  console.log(`Draftable rows (have a summary AND full text): ${count ?? 0}`);
  console.log(`Model: ${getSummaryModel()} via ${describeAiProvider()}`);
  console.log(`Prompt: ${activePrompt.isDefault ? "built-in default" : activePrompt.id}`);

  if (!apply) {
    console.log(`\nDry run — nothing written, no model calls made.`);
    console.log(`Re-run with --apply to draft ${limit} rows (--limit N to change).`);
    console.log(`Rows already drafted are skipped; --redraft replaces them instead.`);
    return;
  }

  if (!hasAiCredentials()) {
    throw new Error("No AI credentials configured — set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY.");
  }

  console.log(`\nDrafting ${limit} row(s)...\n`);
  const result = await runDraftJob(supabase, {
    limit,
    redraft,
    onProgress: (done, total, title) => console.log(`  [${done}/${total}] ${title}`),
  });

  console.log(`\nDrafted: ${result.written} of ${result.attempted}`);
  if (result.flaggedQuoteCount > 0) {
    console.log(
      `Flagged for an unverifiable quote: ${result.flaggedQuoteCount} (kept and marked, shown on the EO page)`,
    );
  }
  if (result.errors.length > 0) {
    console.log(`\nErrors (${result.errors.length}):`);
    for (const message of result.errors) console.log(`  - ${message}`);
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
