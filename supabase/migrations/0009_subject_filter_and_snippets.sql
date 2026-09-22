-- ---------------------------------------------------------------------------
-- Tracker: filter by subject area, and show the matching passage.
--
-- Two changes, one function rewrite, because both land on the same function
-- and a second rewrite would mean a second drop-and-recreate of it.
--
-- 1. SUBJECT FILTER — p_subjects text[]. subject_area is on 100% of rows (26
--    distinct values, all in live use) and there has never been a way to
--    filter by it: it renders as pills and is searchable only by typing the
--    words into the full-text box and hoping. Same semantics as industries:
--    OR within the field, AND against the others. Subjects have no subgroup
--    scheme, so this is a plain array overlap, not the starts_with() dance
--    practice areas need.
--
-- 2. SNIPPETS — a new `snippet` column carrying the passage of full_text
--    around the search terms, so a reader can see WHY a row matched rather
--    than inferring it. Null when not searching, and null when the match
--    came from the title, summary or tags rather than the body (see below).
--
-- The parameter list changes type AND the return type gains a column, so the
-- old function MUST be dropped explicitly first. `create or replace` with
-- different argument types creates a second overload rather than replacing,
-- and PostgREST would then face two candidates of the same name; it also
-- cannot change a return type at all. Signature named in full below, exactly
-- as 0008 left it. See CLAUDE.md on 0001 for what silent versioning problems
-- have already cost this project.
-- ---------------------------------------------------------------------------

drop function if exists search_executive_orders(
  text, text[], text[], text, date, date, text, integer, integer);

-- 0001 created this index, but 0001 is the migration whose later edits were
-- silently never applied, and 0007 defensively re-created three of the four
-- tag indexes without this one. Re-created here rather than assumed: it is a
-- no-op if it already exists, and without it the new subject filter is a
-- sequential scan.
create index if not exists executive_orders_subject_area_idx
  on executive_orders using gin (subject_area);

create function search_executive_orders(
  p_search text default null,
  p_subjects text[] default null,
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
  snippet text,
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
      -- && is array overlap: "any of the selected subjects". Uses the GIN
      -- index on subject_area re-created above.
      and (
        p_subjects is null
        or cardinality(p_subjects) = 0
        or e.subject_area && p_subjects
      )
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
      and (
        p_industries is null
        or cardinality(p_industries) = 0
        or e.industries && p_industries
      )
      and (coalesce(p_status, '') = '' or e.status = p_status)
      and (p_date_from is null or e.date_signed >= p_date_from)
      and (p_date_to is null or e.date_signed <= p_date_to)
  ),
  -- Paged BEFORE the snippet is built. Window functions run before LIMIT, so
  -- total_count is still the full match count, but ts_headline then reads
  -- full_text for the 25 rows on this page instead of for all 164 matches.
  -- Built the other way round, one search would headline several megabytes
  -- of statutory text to show 25 fragments.
  page as (
    select
      m.*,
      count(*) over () as total_count
    from matched m
    order by
      case when p_sort = 'relevance' then m.rank end desc nulls last,
      m.date_signed desc nulls last,
      m.id
    limit coalesce(p_limit, 2147483647)
    offset coalesce(p_offset, 0)
  ),
  highlighted as (
    select
      p.*,
      case
        when (select tsq from query) is null then null
        -- Sentinel markers, not HTML tags. The UI splits on these and
        -- renders its own elements, so a document containing markup can
        -- never inject it into the page -- which is exactly what returning
        -- "<mark>" from the database and trusting it would invite.
        else ts_headline(
               'english',
               coalesce(p.full_text, ''),
               (select tsq from query),
               'StartSel=[[hl]], StopSel=[[/hl]], MaxFragments=1, MaxWords=30, MinWords=12'
             )
      end as headline
    from page p
  )
  select
    h.id,
    h.eo_number,
    h.action_type,
    h.title,
    h.date_signed,
    h.status,
    h.subject_area,
    h.practice_areas,
    h.industries,
    h.legal_challenges,
    h.needs_review,
    h.review_reason,
    h.ai_summary,
    -- ts_headline returns the opening of the document when the query does
    -- not appear in it at all, which happens whenever a row matched on its
    -- title, summary or tags (weights A and B) rather than its body (D), and
    -- on the 54 legacy rows that have no full_text. An unmarked opening
    -- paragraph presented as "why this matched" would be a confident lie, so
    -- a headline carrying no marker becomes null and the UI shows the
    -- summary instead. Checking for the marker costs a string scan; checking
    -- properly would cost a second to_tsvector over the whole body.
    case when h.headline like '%[[hl]]%' then h.headline end as snippet,
    h.total_count
  from highlighted h
  -- Repeated, not inherited: ordering inside a CTE is not guaranteed to
  -- survive into the outer query.
  order by
    case when p_sort = 'relevance' then h.rank end desc nulls last,
    h.date_signed desc nulls last,
    h.id;
$$;

-- 0003 found this project's default privileges were missing entirely, so
-- grant explicitly rather than trusting inheritance. The signature changed,
-- so 0008's grant does NOT carry over -- without this the function exists
-- and every anonymous read of the tracker fails.
grant execute on function search_executive_orders(
  text, text[], text[], text[], text, date, date, text, integer, integer)
  to anon, authenticated, service_role;
