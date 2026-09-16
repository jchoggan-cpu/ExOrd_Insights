#!/usr/bin/env node
/**
 * Re-tags executive orders with practice areas and industries — and nothing
 * else.
 *
 * Usage:
 *   npm run classify -- --limit 20              # pilot: classifies 20 rows, writes a review file, changes nothing
 *   npm run classify -- --limit 20 --model claude-haiku-4-5   # price/compare another model on the same rows
 *   npm run classify -- --limit 20 --apply      # writes those 20
 *   npm run classify -- --apply                 # the whole corpus
 *   npm run classify -- --apply --max-cost 25   # stop once today's recorded spend passes this
 *   npm run classify -- --tagged-with Governmental --limit 20   # only rows already carrying that area
 *
 * Why this exists instead of re-running enrichment: classification currently
 * happens inside summarization, and the enrich job only selects rows whose
 * summary is null. Re-tagging through that path would regenerate summaries —
 * including the 338 the firm wrote by hand. This writes practice_areas and
 * industries only; no summary column is touched on any code path here.
 *
 * Before the first row is written, every existing tag is snapshotted to
 * data/practice-area-tags-before.json, so a run that turns out worse than
 * what it replaced can be undone.
 *
 * Safe to interrupt: work is written row by row, and --only-untagged picks
 * up where a stopped run left off.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAnthropicClient, describeAiProvider, getClassifyModel, hasAiCredentials } from "../src/lib/ai-model";
import { classifyDocument } from "../src/lib/classify/classify-document";
import { buildClassifyPrompt } from "../src/lib/classify/classify-prompt";
import { getServiceRoleClient } from "../src/lib/supabase";
import { getUsageSummary } from "../src/lib/usage/daily";
import { recordApiUsage } from "../src/lib/usage/record";

const SNAPSHOT_FILE = "data/practice-area-tags-before.json";
const REVIEW_FILE_PREFIX = "data/practice-area-tags-review";

/**
 * Stops the loop once today's recorded spend passes this — a backstop
 * against a runaway loop or a mispriced model, not a budget. The run is
 * resumable, so stopping early costs nothing but a re-run.
 */
const DEFAULT_MAX_COST_USD = 40;

/** How often to print progress and re-check the spend cap, in rows. */
const PROGRESS_EVERY = 10;

interface TagRow {
  id: string;
  eo_number: string | null;
  title: string;
  action_type: string | null;
  practice_areas: string[];
  industries: string[];
  full_text: string | null;
  ai_summary: string | null;
}

/** An explicit --model beats the configured default, so one run can be priced against another. */
function stringFlag(args: string[], flag: string): string | null {
  const at = args.indexOf(flag);
  if (at === -1) return null;
  const value = args[at + 1];
  if (value === undefined || value.startsWith("--")) throw new Error(`${flag} needs a value.`);
  return value;
}

function numberFlag(args: string[], flag: string, fallback: number): number {
  const at = args.indexOf(flag);
  if (at === -1) return fallback;
  const parsed = Number(args[at + 1]);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`${flag} needs a positive number, got: ${args[at + 1] ?? "(nothing)"}`);
  }
  return parsed;
}

async function fetchRows(
  supabase: SupabaseClient,
  filter: { onlyUntagged: boolean; taggedWith: string | null },
  limit: number | null,
): Promise<TagRow[]> {
  let query = supabase
    .from("executive_orders")
    .select("id, eo_number, title, action_type, practice_areas, industries, full_text, ai_summary")
    .order("date_signed", { ascending: false });
  if (filter.onlyUntagged) query = query.eq("practice_areas", "{}");
  // Re-tagging just the rows that already carry one area — used to subdivide
  // a practice into its subgroups without paying to re-run the whole corpus.
  if (filter.taggedWith) query = query.contains("practice_areas", [filter.taggedWith]);
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load executive orders: ${error.message}`);
  return (data ?? []) as TagRow[];
}

/** The text to classify from, and whether it is a summary rather than the instrument. */
function sourceFor(row: TagRow): { sourceText: string; sourceIsSummary: boolean } | null {
  if (row.full_text) return { sourceText: row.full_text, sourceIsSummary: false };
  if (row.ai_summary) return { sourceText: row.ai_summary, sourceIsSummary: true };
  return null;
}

interface TagChange {
  id: string;
  eoNumber: string | null;
  title: string;
  before: { practiceAreas: string[]; industries: string[] };
  after: { practiceAreas: string[]; industries: string[] };
}

async function main() {
  const args = process.argv.slice(2);
  const apply = args.includes("--apply");
  const onlyUntagged = args.includes("--only-untagged");
  const limit = args.includes("--limit") ? numberFlag(args, "--limit", 0) : null;
  const maxCost = numberFlag(args, "--max-cost", DEFAULT_MAX_COST_USD);

  if (!hasAiCredentials()) {
    throw new Error("No AI credentials. Set ANTHROPIC_API_KEY or AI_GATEWAY_API_KEY in .env.local.");
  }

  const supabase = getServiceRoleClient();
  const rows = await fetchRows(supabase, { onlyUntagged, taggedWith: stringFlag(args, "--tagged-with") }, limit);
  const model = stringFlag(args, "--model") ?? getClassifyModel();
  const client = createAnthropicClient();
  const systemPrompt = buildClassifyPrompt();

  console.log(`${rows.length} rows to classify`);
  console.log(`Model: ${model} via ${describeAiProvider()}`);
  console.log(`Spend cap: $${maxCost.toFixed(2)} of today's recorded usage`);
  console.log(apply ? "Mode: APPLY — tags will be written\n" : "Mode: dry run — nothing will be written\n");

  // Snapshot before the first write, never after: a run that replaces good
  // tags with worse ones has to be undoable.
  if (apply) {
    const { data, error } = await supabase
      .from("executive_orders")
      .select("id, eo_number, title, practice_areas, industries");
    if (error) throw new Error(`Failed to snapshot existing tags: ${error.message}`);
    await writeFile(
      SNAPSHOT_FILE,
      `${JSON.stringify({ takenAt: new Date().toISOString(), rows: data }, null, 2)}\n`,
      "utf8",
    );
    console.log(`Snapshotted ${data?.length ?? 0} rows' existing tags to ${SNAPSHOT_FILE}\n`);
  }

  const startingSpend = (await getUsageSummary(supabase, 1)).today.costUsd;
  const changes: TagChange[] = [];
  let classified = 0;
  let skipped = 0;
  let failed = 0;

  for (const row of rows) {
    const source = sourceFor(row);
    if (!source) {
      skipped++;
      continue;
    }

    let result;
    try {
      const outcome = await classifyDocument({
        client,
        model,
        systemPrompt,
        input: {
          title: row.title,
          actionType: row.action_type ?? "Executive Order",
          ...source,
        },
      });
      result = outcome.result;
      await recordApiUsage(supabase, { feature: "classify", model, usage: outcome.usage });
    } catch (err) {
      // One unparseable row must not end a 600-row run, but it must be
      // visible — a silently skipped row looks identical to an untagged one.
      failed++;
      console.log(`  ! ${row.eo_number ?? row.title.slice(0, 40)}: ${err instanceof Error ? err.message : err}`);
      continue;
    }

    classified++;
    changes.push({
      id: row.id,
      eoNumber: row.eo_number,
      title: row.title,
      before: { practiceAreas: row.practice_areas ?? [], industries: row.industries ?? [] },
      after: { practiceAreas: result.practiceAreas, industries: result.industries },
    });

    if (apply) {
      const { error } = await supabase
        .from("executive_orders")
        .update({ practice_areas: result.practiceAreas, industries: result.industries })
        .eq("id", row.id);
      if (error) throw new Error(`Failed to write tags for ${row.eo_number ?? row.id}: ${error.message}`);
    }

    // Checked on the same cadence as the progress line rather than every
    // row: the spend total is a database round-trip, and 600 of them would
    // cost more wall-clock than the model calls they are guarding. The cap
    // is a runaway backstop, so being up to PROGRESS_EVERY rows late in
    // noticing is harmless — the run is resumable either way.
    if (classified % PROGRESS_EVERY !== 0 && classified !== 1) continue;

    const spendNow = (await getUsageSummary(supabase, 1)).today.costUsd;
    console.log(
      `  ${classified}/${rows.length} · $${(spendNow - startingSpend).toFixed(2)} this run · ` +
        `${row.eo_number ?? row.title.slice(0, 32)} -> ${result.practiceAreas.length} areas`,
    );

    if (spendNow >= maxCost) {
      console.log(`\nStopping: today's recorded spend reached the $${maxCost.toFixed(2)} cap.`);
      break;
    }
  }

  // Named per model so a bake-off between two models leaves both results on
  // disk to compare, rather than the second silently overwriting the first.
  const reviewFile = `${REVIEW_FILE_PREFIX}.${model.replace(/[^a-z0-9.-]/gi, "-")}.json`;
  await writeFile(
    reviewFile,
    `${JSON.stringify({ generatedAt: new Date().toISOString(), model, changes }, null, 2)}\n`,
    "utf8",
  );

  const finalSpend = (await getUsageSummary(supabase, 1)).today.costUsd;
  const emptyAfter = changes.filter((c) => c.after.practiceAreas.length === 0).length;
  const totalAreas = changes.reduce((s, c) => s + c.after.practiceAreas.length, 0);

  console.log(`\nClassified ${classified}, skipped ${skipped} (no text), failed ${failed}.`);
  console.log(`  practice areas per row: ${classified > 0 ? (totalAreas / classified).toFixed(2) : "0"} average`);
  console.log(`  rows still with no practice area: ${emptyAfter} (${classified > 0 ? Math.round((emptyAfter / classified) * 100) : 0}%)`);
  console.log(`  cost: $${(finalSpend - startingSpend).toFixed(2)} this run, $${finalSpend.toFixed(2)} today`);
  console.log(`\nReview file: ${reviewFile}`);
  if (!apply) console.log(`Dry run — nothing written. Re-run with --apply.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
