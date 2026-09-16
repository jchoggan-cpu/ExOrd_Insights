-- ---------------------------------------------------------------------------
-- Tracker filtering: multi-select practice areas and industries, a signing
-- date range, and practice-area matching that understands subgroups.
--
-- Three changes, one function rewrite.
--
-- 1. SUBGROUP MATCHING — the reason this is urgent rather than a nicety.
--    Practice areas are now stored as "Governmental--National Security"
--    where the practice has subgroups (see src/config/practice-areas.json).
--    0007 matched with `practice_areas @> array[p_practice_area]`, which is
--    exact containment, so selecting "Governmental" in the tracker would
--    match only the handful of rows still carrying the bare parent and miss
--    every subdivided one. A selected parent now matches itself OR any of
--    its subgroups.
--
-- 2. MULTI-SELECT — p_practice_area/p_industry become arrays. Semantics are
--    OR within a field (the firm's choice): selecting two practice areas
--    widens the result set, which is how a reader expects checkboxes to
--    behave. The two fields still AND with each other and with status.
--
-- 3. DATE RANGE — p_date_from / p_date_to over date_signed, inclusive. Every
--    row has a date_signed, so this needs no null handling for the data.
--
-- The parameter list changes type, so the old function MUST be dropped
-- explicitly first: `create or replace` with different argument types
-- creates a second overload rather than replacing, and PostgREST would then
-- face two candidates of the same name. See CLAUDE.md on 0001 for what
-- silent overload/versioning problems cost this project last time.
-- ---------------------------------------------------------------------------

drop function if exists search_executive_orders(text, text, text, text, text, integer, integer);

create or replace function search_executive_orders(
  p_search text default null,
  p_practice_areas text[] default null,
  p_industries text[] default null,
  p_status text default null,
  p_date_from date default null,
  p_date_to date default null,
  p_sort text default 'date',
  -- null means "no limit" — the tracker's "All" page-size option.
  p_limit integer default 25,
  p_offset integer default 0
)
returns table (
  id uuid,
  eo_number text,
  action_type text,
  title text,
  date_signed date,
  status text,
  subject_area text[],
  practice_areas text[],
  industries text[],
  legal_challenges jsonb,
  needs_review boolean,
  review_reason text,
  ai_summary text,
  total_count bigint
)
language sql
stable
set search_path = public
as $$
  with query as (
    select case
             when coalesce(btrim(p_search), '') = '' then null
             -- websearch_to_tsquery is the forgiving, Google-style parser:
             -- "quoted phrase", OR, and -excluded. Unlike to_tsquery it
             -- never raises on malformed input, so a half-typed query
             -- returns results rather than an error.
             else websearch_to_tsquery('english', p_search)
           end as tsq
  ),
  matched as (
    select
      e.*,
      case
        when (select tsq from query) is null then 0
        else ts_rank(e.search_vector, (select tsq from query))
      end as rank
    from executive_orders e
    where
      ((select tsq from query) is null or e.search_vector @@ (select tsq from query))
      -- A selected practice area matches itself or any of its subgroups.
      -- starts_with() rather than LIKE so a name containing a pattern
      -- character can never be read as a wildcard. This cannot use the GIN
      -- index on practice_areas, which is fine at this table's size and is
      -- the deliberate trade for making a parent selection mean what a
      -- reader expects.
      and (
        p_practice_areas is null
        or cardinality(p_practice_areas) = 0
        or exists (
          select 1
          from unnest(e.practice_areas) as tag,
               unnest(p_practice_areas) as wanted
          where tag = wanted or starts_with(tag, wanted || '--')
        )
      )
      -- && is array overlap: "any of the selected industries", which is the
      -- OR semantics the firm chose. Uses the GIN index on industries.
      and (
        p_industries is null
        or cardinality(p_industries) = 0
        or e.industries && p_industries
      )
      and (coalesce(p_status, '') = '' or e.status = p_status)
      and (p_date_from is null or e.date_signed >= p_date_from)
      and (p_date_to is null or e.date_signed <= p_date_to)
  )
  select
    m.id,
    m.eo_number,
    m.action_type,
    m.title,
    m.date_signed,
    m.status,
    m.subject_area,
    m.practice_areas,
    m.industries,
    m.legal_challenges,
    m.needs_review,
    m.review_reason,
    m.ai_summary,
    count(*) over () as total_count
  from matched m
  order by
    case when p_sort = 'relevance' then m.rank end desc nulls last,
    m.date_signed desc nulls last,
    m.id
  limit coalesce(p_limit, 2147483647)
  offset coalesce(p_offset, 0);
$$;

-- 0003 found this project's default privileges were missing entirely, so
-- grant explicitly rather than trusting inheritance. The signature changed,
-- so the old grant does not carry over.
grant execute on function search_executive_orders(text, text[], text[], text, date, date, text, integer, integer)
  to anon, authenticated, service_role;
