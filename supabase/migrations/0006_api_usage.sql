-- Per-call record of what the app spends on the Anthropic API.
--
-- Until now nothing in the app knew what a run cost. The bill was only
-- visible in the Anthropic Console, after the fact, with no way to tell
-- which feature or which day produced it. One row per model call makes the
-- /usage ticker possible and makes "why was yesterday expensive" answerable.
--
-- cost_usd is stored, not derived at read time, because it is computed from
-- the rate table in src/lib/usage/pricing.ts as it stood when the call was
-- made. Pricing changes upstream must not silently rewrite what past runs
-- cost.

create table if not exists api_usage (
  id uuid primary key default gen_random_uuid(),
  -- Which part of the app spent this: "summarize", "draft", "content".
  feature text not null,
  model text not null,
  input_tokens integer not null default 0,
  output_tokens integer not null default 0,
  cache_creation_input_tokens integer not null default 0,
  cache_read_input_tokens integer not null default 0,
  -- numeric, not float: fractions of a cent accumulated over thousands of
  -- rows must not drift. 6 decimal places holds a single cheap call exactly.
  cost_usd numeric(12, 6) not null default 0,
  -- False when the model wasn't in the rate table — the call is still
  -- recorded, but its cost is unknown rather than zero.
  priced boolean not null default true,
  -- Ties a row to the ingestion run that caused it, where there was one.
  ingestion_run_id uuid references ingestion_runs (id) on delete set null,
  created_at timestamptz not null default now()
);

-- The ticker reads "today" and "the last N days", both ordered by time.
create index if not exists api_usage_created_at_idx on api_usage (created_at desc);

alter table api_usage enable row level security;

-- Reads follow 0002's precedent (the boundary today is SITE_PASSWORD, not
-- Supabase Auth); writes stay is_admin()-gated like every other table, so
-- only the service-role key the jobs use can record usage.
create policy "api_usage: read all" on api_usage
  for select using (true);
create policy "api_usage: admin writes" on api_usage
  for all using (is_admin()) with check (is_admin());

-- Granted explicitly rather than trusting inherited defaults — see 0003.
grant select on api_usage to anon, authenticated;
grant select, insert, update, delete on api_usage to service_role;
