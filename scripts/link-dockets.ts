#!/usr/bin/env node
/**
 * Links the legal challenges the firm already recorded to their real
 * CourtListener dockets, so every case in the tracker carries a working
 * link instead of a bare name.
 *
 * Usage:
 *   npm run link:dockets                 # dry run — searches, writes the review file, changes nothing
 *   npm run link:dockets -- --apply      # re-searches, then writes confident matches and your resolved choices
 *   npm run link:dockets -- --from-file --apply   # writes exactly what the review file already says (no searching)
 *   npm run link:dockets -- --limit 20   # first N orders only, for a quick look
 *   npm run link:dockets -- --delay 2000 # slow the requests down further
 *
 * Costs nothing: CourtListener's search API answers anonymous requests, and
 * no model is called at any point. The matching is entirely deterministic
 * (see src/lib/courtlistener/match-case.ts) — a docket is only attached on
 * an exact case-name match, in the recorded court, with no rival candidate.
 * Anything less certain is written to the review file for a human instead,
 * because for a law firm a wrong docket link is worse than an empty cell.
 *
 * The review file (data/legal-challenge-links.json) is committed to the
 * repo on purpose: it is both the work queue for ambiguous cases and the
 * record of what was linked, when, and on what basis.
 *
 * To resolve an ambiguous entry: open the review file, find the entry, pick
 * the right docket from its "candidates", copy that candidate's "docketId"
 * into the entry's "chosenDocketId", then re-run with --from-file --apply.
 *
 * Prefer --from-file whenever you have reviewed the file: a plain --apply
 * searches again first, so what it writes is what the API returns now, not
 * what you actually read.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { readFile, writeFile } from "node:fs/promises";
import type { SupabaseClient } from "@supabase/supabase-js";
import { searchDockets } from "../src/lib/courtlistener/client";
import {
  applyLinkToChallenge,
  buildLinkPlan,
  summarizeLinkPlan,
  type ChallengeLinkDecision,
  type ChallengeRow,
  type DocketLink,
  type StoredChallenge,
} from "../src/lib/courtlistener/link-report";
import { getServiceRoleClient } from "../src/lib/supabase";

const REVIEW_FILE = "data/legal-challenge-links.json";

/**
 * Pause between searches. CourtListener is a free service run by a
 * nonprofit and anonymous callers are throttled hardest — 1.2s spacing was
 * measured 429ing after about 25 requests. At ~150 distinct case names this
 * adds roughly six minutes to a full run, which is a fair trade for not
 * hammering them; the client retries with backoff if it still gets throttled.
 * Set COURTLISTENER_API_TOKEN (free) and this can safely come down.
 */
const DEFAULT_DELAY_MS = 2500;

function hasFlag(args: string[], flag: string): boolean {
  return args.includes(flag);
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** Identifies one stored challenge across runs, so hand-made choices survive a re-run. */
function decisionKey(d: { eoId: string; caseName: string; court: string }): string {
  return `${d.eoId}::${d.caseName}::${d.court}`;
}

async function fetchRows(supabase: SupabaseClient, limit: number | null): Promise<ChallengeRow[]> {
  let query = supabase
    .from("executive_orders")
    .select("id, eo_number, title, date_signed, legal_challenges")
    .neq("legal_challenges", "[]")
    .order("date_signed", { ascending: true });
  if (limit) query = query.limit(limit);

  const { data, error } = await query;
  if (error) throw new Error(`Failed to load executive orders: ${error.message}`);

  return (data ?? []).map((r) => ({
    id: r.id as string,
    eoNumber: (r.eo_number as string | null) ?? null,
    title: r.title as string,
    dateSigned: (r.date_signed as string | null) ?? null,
    legalChallenges: (r.legal_challenges as StoredChallenge[]) ?? [],
  }));
}

/**
 * Reads the whole saved review file, or null when there isn't one yet.
 * A missing file is normal on the first run; anything else — unreadable,
 * or not valid JSON — is reported rather than quietly treated as "no
 * choices saved", which would silently discard a human's review work.
 */
async function readReviewFile(): Promise<{ decisions?: ChallengeLinkDecision[] } | null> {
  let raw: string;
  try {
    raw = await readFile(REVIEW_FILE, "utf8");
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw new Error(`Could not read ${REVIEW_FILE}: ${cause instanceof Error ? cause.message : String(cause)}`);
  }

  try {
    return JSON.parse(raw);
  } catch (cause) {
    throw new Error(
      `${REVIEW_FILE} is not valid JSON (${cause instanceof Error ? cause.message : String(cause)}). ` +
        `Fix or delete it — continuing would silently ignore any choices recorded in it.`,
    );
  }
}

/** Previously-saved choices, keyed so a re-run doesn't discard human work. */
async function loadSavedChoices(): Promise<Map<string, number>> {
  const choices = new Map<string, number>();
  const saved = await readReviewFile();
  for (const d of saved?.decisions ?? []) {
    if (typeof d.chosenDocketId === "number") choices.set(decisionKey(d), d.chosenDocketId);
  }
  return choices;
}

/** The docket to write for a decision: the confident match, or the human's pick. */
function resolvedLink(decision: ChallengeLinkDecision): DocketLink | null {
  if (decision.outcome === "confident") return decision.link;
  if (decision.chosenDocketId === null) return null;
  return decision.candidates.find((c) => c.docketId === decision.chosenDocketId) ?? null;
}

async function writeLinks(
  supabase: SupabaseClient,
  rows: ChallengeRow[],
  decisions: ChallengeLinkDecision[],
): Promise<number> {
  const byEo = new Map<string, ChallengeLinkDecision[]>();
  for (const d of decisions) {
    byEo.set(d.eoId, [...(byEo.get(d.eoId) ?? []), d]);
  }

  let updatedRows = 0;
  for (const row of rows) {
    const forRow = byEo.get(row.id) ?? [];
    let changed = false;

    const updated = row.legalChallenges.map((challenge) => {
      const decision = forRow.find(
        (d) => d.caseName === (challenge.caseName ?? "").trim() && d.court === (challenge.court ?? "").trim(),
      );
      const link = decision ? resolvedLink(decision) : null;
      if (!link) return challenge;

      const merged = applyLinkToChallenge(challenge, link);
      if (merged !== challenge) changed = true;
      return merged;
    });

    if (!changed) continue;

    const { error } = await supabase.from("executive_orders").update({ legal_challenges: updated }).eq("id", row.id);
    if (error) throw new Error(`Failed to update ${row.eoNumber ?? row.title}: ${error.message}`);
    updatedRows++;
  }

  return updatedRows;
}

/**
 * Writes the review file and returns its summary. `partial` marks a file
 * written from an interrupted run, so a reader can tell an incomplete pass
 * from a finished one.
 */
async function saveReviewFile(decisions: ChallengeLinkDecision[], options: { partial?: boolean } = {}) {
  const summary = summarizeLinkPlan(decisions);
  const body = {
    generatedAt: new Date().toISOString().slice(0, 10),
    ...(options.partial ? { partial: true } : {}),
    summary,
    decisions,
  };
  await writeFile(REVIEW_FILE, `${JSON.stringify(body, null, 2)}\n`, "utf8");
  return summary;
}

async function main() {
  const args = process.argv.slice(2);
  const apply = hasFlag(args, "--apply");
  const fromFile = hasFlag(args, "--from-file");
  const limit = args.includes("--limit") ? numberFlag(args, "--limit", 0) : null;
  const delayMs = numberFlag(args, "--delay", DEFAULT_DELAY_MS);

  const supabase = getServiceRoleClient();
  const rows = await fetchRows(supabase, limit);
  const entryCount = rows.reduce((n, r) => n + r.legalChallenges.length, 0);
  console.log(`${rows.length} orders carry ${entryCount} recorded legal challenges.`);

  // Applying straight from the reviewed file: no searching, so what gets
  // written is exactly what was read and approved, rather than whatever a
  // fresh search returns minutes later.
  if (fromFile) {
    const saved = await readReviewFile();
    if (!saved?.decisions?.length) {
      throw new Error(`No decisions found in ${REVIEW_FILE}. Run the dry run first to produce it.`);
    }
    const summary = summarizeLinkPlan(saved.decisions);
    const byHand = saved.decisions.filter((d) => d.outcome !== "confident" && resolvedLink(d) !== null).length;
    console.log(`\nApplying ${REVIEW_FILE} as reviewed: ${summary.confident} confident + ${byHand} resolved by hand.`);

    if (!apply) {
      console.log(`Dry run — nothing written. Add --apply to write these ${summary.confident + byHand} links.`);
      return;
    }
    console.log(`\nApplied: ${await writeLinks(supabase, rows, saved.decisions)} orders updated.`);
    return;
  }

  console.log(`Searching CourtListener (${delayMs}ms between requests, no API key, no model calls)...\n`);

  let searches = 0;
  // Accumulated as we go, so a run that dies part-way (a rate-limit refusal
  // several minutes in is the realistic case) still leaves its completed
  // lookups on disk instead of throwing them all away.
  const soFar: ChallengeLinkDecision[] = [];
  let decisions: ChallengeLinkDecision[];
  try {
    decisions = await buildLinkPlan({
      rows,
      searchDockets,
      onDecision: (decision) => soFar.push(decision),
      onSearch: async (caseName, court) => {
        if (searches > 0) await sleep(delayMs);
        searches++;
        process.stdout.write(`  [${searches}] ${caseName} (${court || "no court"})\n`);
      },
    });
  } catch (err) {
    await saveReviewFile(soFar, { partial: true });
    console.error(`\nRun stopped after ${soFar.length} of ${entryCount} entries.`);
    console.error(`Partial results saved to ${REVIEW_FILE} — re-run to continue.`);
    throw err;
  }

  const saved = await loadSavedChoices();
  for (const decision of decisions) {
    const choice = saved.get(decisionKey(decision));
    if (choice !== undefined) decision.chosenDocketId = choice;
  }

  const summary = await saveReviewFile(decisions);

  console.log(`\n${searches} searches for ${summary.total} recorded challenges.`);
  console.log(`  linked (confident): ${summary.confident}  — ${summary.distinctCasesLinked} distinct dockets`);
  console.log(`  need a human:       ${summary.ambiguous}`);
  console.log(`  not found:          ${summary.notFound}`);
  console.log(`\nReview file written to ${REVIEW_FILE}`);

  const resolvedByHand = decisions.filter((d) => d.outcome !== "confident" && resolvedLink(d) !== null).length;
  if (resolvedByHand > 0) {
    console.log(`  (${resolvedByHand} ambiguous entries resolved by hand in that file)`);
  }

  if (!apply) {
    const writable = summary.confident + resolvedByHand;
    console.log(`\nDry run — nothing was written to the database. Re-run with --apply to write ${writable} links.`);
    return;
  }

  const updatedRows = await writeLinks(supabase, rows, decisions);
  console.log(`\nApplied: ${updatedRows} orders updated.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
