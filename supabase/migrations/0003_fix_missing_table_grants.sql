-- Fix missing base table grants for anon/authenticated/service_role.
--
-- Discovered while running the legacy data import: INSERT into
-- executive_orders failed with "permission denied for table
-- executive_orders" even via the service-role client, which bypasses RLS
-- but does NOT bypass ordinary Postgres table grants.
--
-- Root cause: this project's `postgres` role has its default table
-- privileges for anon/authenticated/service_role set to only
-- truncate/references/trigger/maintain (`Dxtm`), missing
-- select/insert/update/delete entirely (`arwd`) — confirmed via
-- `pg_default_acl`. Supabase projects normally get the full `arwdDxtm` set
-- automatically; this one is missing it, most likely because it was
-- provisioned through Vercel's Marketplace integration rather than
-- supabase.com directly, which appears to skip that bootstrap step. Every
-- table any migration creates in this project inherits the same gap.
--
-- RLS policies (0001, 0002) are unaffected and still govern what anon/
-- authenticated can actually read/write — this only restores the base
-- grants those policies depend on to be reachable at all.

grant select, insert, update, delete on all tables in schema public
  to anon, authenticated, service_role;

-- So future migrations' tables don't hit the same gap.
alter default privileges for role postgres in schema public
  grant select, insert, update, delete on tables to anon, authenticated, service_role;
