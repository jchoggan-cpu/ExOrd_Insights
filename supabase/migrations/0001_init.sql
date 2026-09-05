-- EO Tracker & Content Assistant — initial schema
-- Run against a Supabase (Postgres) project. See README.md for setup.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- profiles: one row per app user, extends Supabase's built-in auth.users with
-- the admin/general role split described in the build plan.
-- ---------------------------------------------------------------------------
create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  role text not null default 'general' check (role in ('admin', 'general')),
  receives_digest boolean not null default true,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- executive_orders: one row per EO. AI-generated fields (ai_summary,
-- subject_area, practice_areas, industries, legal_challenges, news_mentions)
-- are overwritten by the automated pipeline UNLESS the field name appears in
-- manually_edited_fields, which an admin sets when they correct something.
-- ---------------------------------------------------------------------------
create table if not exists executive_orders (
  id uuid primary key default gen_random_uuid(),
  -- Present only for true Executive Orders (e.g. "EO 14351"); null for
  -- Proclamations, Memoranda, and other action types. action_type holds the
  -- source spreadsheet's "Type/Number" text split apart (see action_type).
  -- Intentionally NOT unique: the imported legacy data has a handful of
  -- EO numbers appearing on two rows with different content (see README
  -- "Known data quality issues") — reconcile against the Federal Register
  -- once Phase 2 ingestion is live rather than enforcing uniqueness here.
  eo_number text,
  action_type text,
  title text not null,
  federal_register_url text,
  date_signed date,
  date_published date,
  status text not null default 'active' check (status in ('active', 'amended', 'revoked')),
  agencies_impacted text[] not null default '{}',
  key_dates jsonb not null default '[]',        -- [{ "label": string, "date": string }]

  -- Tagging (see src/config/practice-areas.json and industries.json)
  subject_area text[] not null default '{}',    -- free-form, AI-inferred
  practice_areas text[] not null default '{}',  -- from the fixed Sheppard list
  industries text[] not null default '{}',      -- from the fixed Sheppard list

  -- Narrative / analysis fields (mirrors the legacy spreadsheet + AI additions)
  ai_summary text,
  deliverable text,
  timeline_notes text,
  available_analysis text,
  legal_challenges jsonb not null default '[]', -- [{ case_name, court, status, docket_url, summary }]
  news_mentions jsonb not null default '[]',     -- [{ title, source, url, date, snippet }]

  manually_edited_fields text[] not null default '{}',

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists executive_orders_date_signed_idx on executive_orders (date_signed desc);
create index if not exists executive_orders_practice_areas_idx on executive_orders using gin (practice_areas);
create index if not exists executive_orders_industries_idx on executive_orders using gin (industries);
create index if not exists executive_orders_subject_area_idx on executive_orders using gin (subject_area);

-- ---------------------------------------------------------------------------
-- rescinded_prior_orders: pre-2025 executive orders the current
-- administration has rescinded (imported from the firm's "Rescinded Exec
-- Actions" tracker sheet). Reference data — not part of the current
-- administration's own EO count.
-- ---------------------------------------------------------------------------
create table if not exists rescinded_prior_orders (
  id uuid primary key default gen_random_uuid(),
  order_number text,
  date_signed date,
  title text not null,
  administration text not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- agency_actions: non-EO agency-level actions (memos, guidance) tracked
-- alongside executive orders (imported from the firm's "Select Agency
-- Actions" tracker sheet). Not a comprehensive list — curated highlights.
-- ---------------------------------------------------------------------------
create table if not exists agency_actions (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  issuing_agency text not null,
  key_date date,
  other_agencies_impacted text[] not null default '{}',
  legal_challenges jsonb not null default '[]',
  available_analysis text,
  related_eo_number text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- content_drafts: generated blog posts / client alerts / talking points /
-- social posts, tied to one or more EOs (multi-EO "digest" content included).
-- ---------------------------------------------------------------------------
create table if not exists content_drafts (
  id uuid primary key default gen_random_uuid(),
  eo_ids uuid[] not null,
  content_type text not null check (content_type in ('client_alert', 'blog_post', 'talking_points', 'social_post')),
  title text,
  draft_text text not null,
  created_by uuid references profiles (id),
  -- Set when a user confirms "I have reviewed this draft for accuracy" in the
  -- UI (see src/components/content-drafter.tsx) — export is gated on this
  -- client-side today; once drafts are persisted (Phase 4), enforce it here too.
  reviewed_at timestamptz,
  reviewed_by uuid references profiles (id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- ingestion_runs: audit log for the automated Federal Register / litigation
-- & news sweeps, so failures are visible without digging through logs.
-- ---------------------------------------------------------------------------
create table if not exists ingestion_runs (
  id uuid primary key default gen_random_uuid(),
  run_type text not null check (run_type in ('federal_register', 'litigation_news', 'digest_email')),
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running' check (status in ('running', 'success', 'partial', 'failure')),
  new_count integer not null default 0,
  updated_count integer not null default 0,
  error_message text
);

-- ---------------------------------------------------------------------------
-- Row Level Security
-- Automated jobs use the Supabase service-role key, which bypasses RLS, so
-- these policies only govern what signed-in app users can do directly.
-- ---------------------------------------------------------------------------
alter table profiles enable row level security;
alter table executive_orders enable row level security;
alter table rescinded_prior_orders enable row level security;
alter table agency_actions enable row level security;
alter table content_drafts enable row level security;
alter table ingestion_runs enable row level security;

create or replace function is_admin()
returns boolean
language sql
security definer
stable
as $$
  select exists (
    select 1 from profiles where id = auth.uid() and role = 'admin'
  );
$$;

-- profiles: users can read their own row; admins can read/update everyone's.
create policy "profiles: read own" on profiles
  for select using (id = auth.uid() or is_admin());
create policy "profiles: admin manages roles" on profiles
  for update using (is_admin());

-- executive_orders: every signed-in user can read; only admins can edit
-- directly (the automated pipeline writes via the service-role key).
create policy "eo: read all authenticated" on executive_orders
  for select using (auth.role() = 'authenticated');
create policy "eo: admin edits" on executive_orders
  for update using (is_admin());
create policy "eo: admin inserts" on executive_orders
  for insert with check (is_admin());
create policy "eo: admin deletes" on executive_orders
  for delete using (is_admin());

-- rescinded_prior_orders / agency_actions: read-all-authenticated, admin edits.
create policy "rescinded: read all authenticated" on rescinded_prior_orders
  for select using (auth.role() = 'authenticated');
create policy "rescinded: admin writes" on rescinded_prior_orders
  for all using (is_admin()) with check (is_admin());

create policy "agency_actions: read all authenticated" on agency_actions
  for select using (auth.role() = 'authenticated');
create policy "agency_actions: admin writes" on agency_actions
  for all using (is_admin()) with check (is_admin());

-- content_drafts: any signed-in user can read all drafts (shared team
-- recordkeeping) and create their own; only the author or an admin can edit.
create policy "drafts: read all authenticated" on content_drafts
  for select using (auth.role() = 'authenticated');
create policy "drafts: create own" on content_drafts
  for insert with check (created_by = auth.uid());
create policy "drafts: author or admin edits" on content_drafts
  for update using (created_by = auth.uid() or is_admin());
create policy "drafts: author or admin deletes" on content_drafts
  for delete using (created_by = auth.uid() or is_admin());

-- ingestion_runs: admin-only visibility (operational/debug data).
create policy "ingestion: admin only" on ingestion_runs
  for select using (is_admin());
