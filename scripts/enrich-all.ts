#!/usr/bin/env node
/**
 * Summarizes the entire enrichment backlog in one sitting, instead of
 * waiting out the nightly cron's ENRICH_BATCH_SIZE rows a day.
 *
 * Usage:
 *   npm run enrich:all                        # dry run — counts the queue, prices it, calls no model
 *   npm run enrich:all -- --apply             # works the queue down to empty
 *   npm run enrich:all -- --apply --max-cost 10
 *
 * Runs locally rather than as a cron endpoint for the same reason as the
 * backfill: a few hundred full-text model calls will outlast any serverless
 * function's duration limit.
 *
 * Safe to interrupt and safe to re-run. Each pass only selects rows where
 * ai_summary IS NULL, so stopping partway — whether by Ctrl-C, a spend cap,
 * or running out of API credit — leaves finished rows finished and picks up
 * from there next time. Nothing is half-written.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { runEnrichJob } from "../src/lib/federal-register/enrich-job";
import { getServiceRoleClient } from "../src/lib/supabase";
import { getSummaryModel, describeAiProvider, hasAiCredentials } from "../src/lib/ai-model";
import { loadActiveSummaryPrompt } from "../src/lib/summary-prompt/store";
import { getUsageSummary } from "../src/lib/usage/daily";
import { applyEnrichQueueFilter } from "../src/lib/federal-register/enrich-queue";
import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * Stops the loop once today's recorded spend passes this. A backstop against
 * a runaway loop or a mispriced model, not a budget — the run is resumable,
 * so stopping early costs nothing but a re-run.
 */
const DEFAULT_MAX_COST_USD = 30;

function parseNumberFlag(args: string[], flag: string, fallback: number): number {
  const at = args.indexOf(flag);
  if (at === -1) return fallback;
  const parsed = Number(args[at + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} needs a positive number, got: ${args[at + 1] ?? "(nothing)"}`);
  }
  return parsed;
}

async function queueDepth(supabase: SupabaseClient): Promise<number> {
  // Shares the predicate with the enrichment job and the watchdog — see
  // enrich-queue.ts for why all three must agree.
  const { count, error } = await applyEnrichQueueFilter(
    supabase.from("executive_orders").select("id", { count: "exact", head: true }),
  );
  if (error) throw new Error(`Failed to count the enrichment queue: ${error.message}`);
  return count ?? 0;
}

async function todaySpendUsd(supabase: SupabaseClient): Promise<number> {
  return (await getUsageSummary(supabase, 1)).today.costUsd;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const maxCostUsd = parseNumberFlag(args, "--max-cost", DEFAULT_MAX_COST_USD);
  const supabase = getServiceRoleClient();

  const startingQueue = await queueDepth(supabase);
  const activePrompt = await loadActiveSummaryPrompt(supabase);

  console.log(`Queue: ${startingQueue} rows awaiting a summary`);
  console.log(`Model: ${getSummaryModel()} via ${describeAiProvider()}`);
  console.log(`Prompt: ${activePrompt.isDefault ? "built-in default" : activePrompt.id}`);
  console.log(`Spend cap: $${maxCostUsd.toFixed(2)} of today's recorded usage`);

  if (!apply) {
    console.log(`\nDry run — nothing written, no model calls made. Re-run with --apply.`);
    return;
  }
  if (!hasAiCredentials()) {
    throw new Error("No AI credentials configured — set AI_GATEWAY_API_KEY or ANTHROPIC_API_KEY.");
  }

  const startingSpend = await todaySpendUsd(supabase);
  let remaining = startingQueue;
  let pass = 0;

  while (remaining > 0) {
    const spend = await todaySpendUsd(supabase);
    if (spend >= maxCostUsd) {
      console.log(`\nStopping: today's spend $${spend.toFixed(2)} reached the $${maxCostUsd.toFixed(2)} cap.`);
      console.log(`${remaining} rows still queued — re-run with a higher --max-cost to continue.`);
      break;
    }

    pass++;
    const result = await runEnrichJob(supabase);
    const after = await queueDepth(supabase);
    const done = startingQueue - after;
    const spendNow = await todaySpendUsd(supabase);

    console.log(
      `pass ${pass}: +${result.updatedCount} written, ${result.flaggedCount} flagged · ` +
        `${done}/${startingQueue} done · $${(spendNow - startingSpend).toFixed(2)} spent this run`,
    );
    if (result.errorMessage) console.log(`  errors: ${result.errorMessage}`);

    // A pass that moved nothing means every remaining row is failing for the
    // same reason; looping would just burn money reproducing it.
    if (after >= remaining) {
      console.log(`\nStopping: a full pass summarized nothing, so the remaining ${after} rows are stuck.`);
      console.log(`Check /needs-attention and the errors above before re-running.`);
      break;
    }
    remaining = after;
  }

  const finalSpend = await todaySpendUsd(supabase);
  const finalQueue = await queueDepth(supabase);
  console.log(`\nDone. ${startingQueue - finalQueue} rows summarized, ${finalQueue} still queued.`);
  console.log(`This run cost $${(finalSpend - startingSpend).toFixed(2)}; today's total is $${finalSpend.toFixed(2)}.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
