-- Full-text search, filtering and pagination for the tracker.
--
-- WHY: searching inside an order's own text (not just title and summary)
-- measured at 1,371-2,051ms per query against this table with no index,
-- versus a 187ms baseline for a plain page fetch. That is a search box that
-- feels broken, and it degrades as the administration issues more orders.
--
-- SAFETY: this migration only ADDS — one function, one generated column,
-- four indexes, one search function. No UPDATE, no DELETE, nothing dropped.
-- The 614 rows, including the 338 curated summaries protected by
-- manually_edited_fields, are read to build the column and are otherwise
-- untouched. Reversible by dropping what it creates.
--
-- NOTE ON THE FIRST ATTEMPT: an earlier version of this file used
-- array_to_string() directly inside the generated column and was rejected.
-- array_to_string is marked STABLE, not IMMUTABLE, because it invokes
-- arbitrary type I/O functions (PostgreSQL BUG #17360), and STORED generated
-- columns require an immutable expression. It never reached the migration
-- history — hence this file being corrected in place rather than superseded
-- by an 0008, which would be the rule for an already-applied migration.

-- An immutable wrapper over array_to_string. Safe to assert for text[]
-- specifically: text's I/O functions genuinely are immutable, which is the
-- case the general polymorphic signature cannot promise.
create or replace function eo_array_to_search_text(arr text[])
returns text
language sql
immutable
parallel safe
set search_path = public
as $$ select coalesce(array_to_string(arr, ' '), '') $$;

-- A "tsvector" is Postgres's pre-chewed form of a document: text reduced to
-- normalized search terms. Matching against it is what makes search fast,
-- and it is what gives word stemming ("tariffs" finds "tariff") and
-- Google-style query syntax for free.
--
-- GENERATED ALWAYS ... STORED means Postgres maintains this itself on every
-- insert and update: no trigger to forget, no application code that can
-- leave it stale. The nightly enrichment job keeps it current for free.
--
-- setweight() records WHERE a term was found, which is what makes relevance
-- ranking meaningful: 'A' (title, EO number) outranks 'B' (summary, tags),
-- which outranks 'D' (the body text).
alter table executive_orders
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(eo_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(action_type, '')), 'B') ||
    setweight(to_tsvector('english', eo_array_to_search_text(subject_area)), 'B') ||
    setweight(to_tsvector('english', coalesce(ai_summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(full_text, '')), 'D')
  ) stored;

-- GIN is the index type built for "which rows contain this term". Without
-- it Postgres still answers correctly, just by reading every row — the
-- 1.5-2s measured above.
create index if not exists executive_orders_search_vector_idx
  on executive_orders using gin (search_vector);

-- The default ordering, and the tie-breaker when relevance ties. Paging with
-- ORDER BY on an unindexed column re-sorts the whole table for every page.
create index if not exists executive_orders_date_signed_idx
  on executive_orders (date_signed desc nulls last);

-- Practice-area and industry filters are array-containment tests, which GIN
-- also serves. Without these, every filtered page scans the full table.
create index if not exists executive_orders_practice_areas_idx
  on executive_orders using gin (practice_areas);
create index if not exists executive_orders_industries_idx
  on executive_orders using gin (industries);

-- Search, filter, rank and page in one call.
--
-- WHY A FUNCTION AND NOT JUST QUERY PARAMETERS: relevance ordering needs
-- ORDER BY ts_rank(...), and PostgREST can only order by real columns — a
-- rank is computed per query, so it can never be one. Ranked search is
-- therefore impossible through the REST API alone. Filtering and paging are
-- folded in here too so that the count, the ranking and the page all come
-- from one consistent snapshot of the query.
--
-- SECURITY INVOKER (the default — deliberately NOT security definer): the
-- caller's row-level security still applies, exactly as on a normal select.
--
-- total_count is the number of rows matching BEFORE paging, repeated on
-- every row via a window function. That is what lets the UI say "page 3 of
-- 25" without a second round trip.
create or replace function search_executive_orders(
  p_search text default null,
  p_practice_area text default null,
  p_industry text default null,
  p_status text default null,
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
      and (coalesce(p_practice_area, '') = '' or e.practice_areas @> array[p_practice_area])
      and (coalesce(p_industry, '') = '' or e.industries @> array[p_industry])
      and (coalesce(p_status, '') = '' or e.status = p_status)
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
-- grant explicitly rather than trusting inheritance.
grant execute on function search_executive_orders(text, text, text, text, text, integer, integer)
  to anon, authenticated, service_role;
grant execute on function eo_array_to_search_text(text[]) to anon, authenticated, service_role;
