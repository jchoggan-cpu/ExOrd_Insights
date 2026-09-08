-- Reconcile schema drift between 0001_init.sql and the live database.
--
-- Discovered while running the Federal Register backfill: it failed with
-- "column executive_orders.document_number does not exist". Root cause:
-- 0001_init.sql has been edited in place across several commits (Phase 1
-- scaffold, legacy import, safety mitigations, Phase 2 ingestion) rather
-- than extended via new migration files. `supabase db push`/the GitHub
-- integration track applied migrations by filename, not content — so once
-- "0001" was recorded as applied (against an early version of the file),
-- every later edit to that same file was silently never pushed to the
-- live database. `CREATE TABLE IF NOT EXISTS` masked this further: reruns
-- of 0001 no-op instead of erroring when a table already exists.
--
-- Verified directly against information_schema/pg_indexes/pg_constraint
-- (not just the migration-history log) that exactly two things drifted:
-- executive_orders is missing the entire Federal Register ingestion (Phase
-- 2) column block, and ingestion_runs' run_type check constraint is missing
-- the two Phase 2 run types. Every other table matches 0001_init.sql
-- exactly. Both are fixed here, idempotently, so this is safe to re-run.
--
-- Going forward: extend the schema via new migration files, never by
-- editing an already-applied one — this project's tracking has no way to
-- detect that kind of drift, so it fails silently rather than loudly.

alter table executive_orders
  add column if not exists document_number text unique,
  add column if not exists applied_correction_document_numbers text[] not null default '{}',
  add column if not exists citation text,
  add column if not exists full_text text,
  add column if not exists source_notes text,
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_reason text,
  add column if not exists federal_register_synced_at timestamptz;

create index if not exists executive_orders_applied_corrections_idx
  on executive_orders using gin (applied_correction_document_numbers);

alter table ingestion_runs drop constraint if exists ingestion_runs_run_type_check;
alter table ingestion_runs add constraint ingestion_runs_run_type_check
  check (run_type in (
    'federal_register',
    'federal_register_reconciliation',
    'federal_register_enrichment',
    'litigation_news',
    'digest_email'
  ));
