-- Loosen anon-client SELECT policies to `using (true)`.
--
-- Decided in CLAUDE.md's "Known blocking issue" (see git history for the
-- full writeup this migration resolves): the four tables the app's anon
-- client (`getSupabaseClient()` in src/lib/data.ts) reads directly —
-- executive_orders, ingestion_runs, rescinded_prior_orders, and
-- agency_actions — all had SELECT policies requiring
-- `auth.role() = 'authenticated'` (or is_admin()). Supabase Auth (Phase 5)
-- doesn't exist yet, so no anon-client request could ever satisfy those
-- policies: every read would be silently RLS-denied and fall back to `[]`
-- or stale local data, with nothing surfaced to explain why.
--
-- The actual security boundary today is SITE_PASSWORD (src/lib/site-auth.ts),
-- not per-user Supabase auth — so these authenticated-only read policies
-- were unreachable by design, not a deliberate present-day restriction.
-- Loosening them to `using (true)` matches that reality for this phase.
-- Write policies (insert/update/delete, all gated on is_admin()) are
-- unchanged — only the automated pipeline's service-role key can write.
--
-- Revisit once Phase 5 ships real per-user accounts: tighten these back to
-- `auth.role() = 'authenticated'` (or a role-aware policy) at that point.

drop policy if exists "eo: read all authenticated" on executive_orders;
create policy "eo: read all" on executive_orders
  for select using (true);

drop policy if exists "ingestion: admin only" on ingestion_runs;
create policy "ingestion: read all" on ingestion_runs
  for select using (true);

drop policy if exists "rescinded: read all authenticated" on rescinded_prior_orders;
create policy "rescinded: read all" on rescinded_prior_orders
  for select using (true);

drop policy if exists "agency_actions: read all authenticated" on agency_actions;
create policy "agency_actions: read all" on agency_actions
  for select using (true);
