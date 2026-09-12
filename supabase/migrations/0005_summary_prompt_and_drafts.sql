-- Editable summarization prompt, plus AI draft summaries held alongside the
-- firm's hand-curated ones.
--
-- Two problems this solves:
--
-- 1. The prompt that writes every AI summary was hardcoded in
--    src/lib/federal-register/summarize.ts — invisible in the app and
--    changeable only by a deploy. `summary_prompts` makes it editable at
--    /prompt, versioned so a bad edit can be read back and reverted.
--
-- 2. 338 rows carry summaries the firm wrote by hand; they are the source
--    the current prompt was distilled from and must not be overwritten by a
--    machine pass. `summary_drafts` holds an AI draft *next to* the curated
--    text so the two can be compared per row and promoted deliberately,
--    rather than the pipeline silently replacing human work.
--
-- Follows 0002's precedent for reads (`using (true)` — the real boundary
-- today is SITE_PASSWORD, not Supabase Auth) and 0001's for writes
-- (is_admin(), reachable only via the service-role key). Revisit both at
-- Phase 5 alongside the four tables 0002 loosened.

create table if not exists summary_prompts (
  id uuid primary key default gen_random_uuid(),
  body text not null,
  -- Why this version exists, written by whoever saved it.
  note text,
  is_active boolean not null default false,
  created_at timestamptz not null default now()
);

-- At most one active prompt. A partial unique index rather than application
-- logic, so two concurrent saves can't both leave their row active and leave
-- the pipeline picking one arbitrarily.
create unique index if not exists summary_prompts_one_active
  on summary_prompts (is_active)
  where is_active;

create index if not exists summary_prompts_created_at_idx
  on summary_prompts (created_at desc);

create table if not exists summary_drafts (
  id uuid primary key default gen_random_uuid(),
  executive_order_id uuid not null references executive_orders (id) on delete cascade,
  summary text not null,
  subject_area text[] not null default '{}',
  practice_areas text[] not null default '{}',
  industries text[] not null default '{}',
  -- [{action, deadline, responsibleParty}], or null when the instrument
  -- creates no obligation on a party outside the federal government.
  deliverables jsonb,
  -- Which model and which prompt version produced this draft, so a draft
  -- reviewed weeks later can be judged against what actually generated it.
  model text not null,
  summary_prompt_id uuid references summary_prompts (id) on delete set null,
  -- Quoted material not found verbatim in the row's full_text. On the live
  -- enrich path an unverified quote blocks the write entirely; a draft is
  -- not published to anyone, so it is kept and shown flagged instead —
  -- seeing what the model fabricated is the point of a review queue.
  unverified_quotes text[] not null default '{}',
  created_at timestamptz not null default now()
);

-- One current draft per order: re-running the draft pass replaces the row
-- rather than accumulating versions nobody asked for.
create unique index if not exists summary_drafts_one_per_order
  on summary_drafts (executive_order_id);

alter table summary_prompts enable row level security;
alter table summary_drafts enable row level security;

create policy "summary_prompts: read all" on summary_prompts
  for select using (true);
create policy "summary_prompts: admin writes" on summary_prompts
  for all using (is_admin()) with check (is_admin());

create policy "summary_drafts: read all" on summary_drafts
  for select using (true);
create policy "summary_drafts: admin writes" on summary_drafts
  for all using (is_admin()) with check (is_admin());

-- 0003 found this project's default privileges were missing entirely (the
-- Vercel Marketplace provisioning path appears to skip Supabase's usual
-- bootstrap). 0003 fixed the defaults going forward, but grant explicitly
-- here too rather than trusting that these two tables inherited them.
grant select on summary_prompts to anon, authenticated;
grant select, insert, update, delete on summary_prompts to service_role;
grant select on summary_drafts to anon, authenticated;
grant select, insert, update, delete on summary_drafts to service_role;
