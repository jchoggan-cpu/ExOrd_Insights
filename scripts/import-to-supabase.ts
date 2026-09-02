/**
 * One-time seed import: loads the JSON produced by
 * scripts/import_legacy_tracker.py (src/data/legacy-import/) into a
 * connected Supabase project.
 *
 * Usage:
 *   npm run import:supabase
 *
 * Requires NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY in
 * .env.local — the service role key is required (not the anon key) because
 * this bypasses row-level security to bulk-insert. Get it from Supabase
 * project settings -> API -> service_role secret. Never expose this key to
 * the browser or commit it.
 *
 * This INSERTs fresh rows every run — it does not upsert/dedupe against
 * existing data (the legacy dataset has no reliable unique key; see README
 * "Known data quality issues"). Run it once against a freshly-migrated,
 * empty database. Running it again will duplicate rows.
 */
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";
import executiveOrders from "../src/data/legacy-import/executive-orders.json";
import rescindedPriorOrders from "../src/data/legacy-import/rescinded-prior-orders.json";
import agencyActions from "../src/data/legacy-import/agency-actions.json";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SERVICE_ROLE_KEY) {
  console.error(
    "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in .env.local — see this script's header comment.",
  );
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);

const BATCH_SIZE = 100;

async function insertBatched(table: string, rows: Record<string, unknown>[]) {
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    const { error } = await supabase.from(table).insert(batch);
    if (error) {
      throw new Error(`Failed inserting into ${table} (rows ${i}-${i + batch.length}): ${error.message}`);
    }
    inserted += batch.length;
  }
  console.log(`Inserted ${inserted} rows into ${table}`);
}

function toExecutiveOrderRow(eo: (typeof executiveOrders)[number]) {
  // Deliberately omit `id` — let Postgres assign a fresh UUID (see header comment).
  return {
    eo_number: eo.eoNumber,
    action_type: eo.actionType,
    title: eo.title,
    federal_register_url: eo.federalRegisterUrl,
    date_signed: eo.dateSigned || null,
    date_published: eo.datePublished,
    status: eo.status,
    agencies_impacted: eo.agenciesImpacted,
    key_dates: eo.keyDates,
    subject_area: eo.subjectArea,
    practice_areas: eo.practiceAreas,
    industries: eo.industries,
    ai_summary: eo.aiSummary,
    deliverable: eo.deliverable,
    timeline_notes: eo.timelineNotes,
    available_analysis: eo.availableAnalysis,
    legal_challenges: eo.legalChallenges,
    news_mentions: eo.newsMentions,
    manually_edited_fields: eo.manuallyEditedFields,
  };
}

function toRescindedRow(r: (typeof rescindedPriorOrders)[number]) {
  return {
    order_number: r.orderNumber,
    date_signed: r.dateSigned,
    title: r.title,
    administration: r.administration,
  };
}

function toAgencyActionRow(a: (typeof agencyActions)[number]) {
  return {
    title: a.title,
    issuing_agency: a.issuingAgency,
    key_date: a.keyDate,
    other_agencies_impacted: a.otherAgenciesImpacted,
    legal_challenges: a.legalChallenges,
    available_analysis: a.availableAnalysis,
    related_eo_number: a.relatedEoNumber,
  };
}

async function main() {
  console.log(`Importing into ${SUPABASE_URL} ...`);
  await insertBatched("executive_orders", executiveOrders.map(toExecutiveOrderRow));
  await insertBatched("rescinded_prior_orders", rescindedPriorOrders.map(toRescindedRow));
  await insertBatched("agency_actions", agencyActions.map(toAgencyActionRow));
  console.log("Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
