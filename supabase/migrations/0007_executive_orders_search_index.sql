-- Full-text search index for the tracker's search box.
--
-- WHY: searching inside an order's own text (not just its title and summary)
-- measured at 1,371-2,051ms per query against this table without an index,
-- versus a 187ms baseline for a plain page fetch. That is a search box that
-- feels broken, and it gets worse as the administration issues more orders.
-- A pre-computed, indexed search column moves that work to write time.
--
-- SAFETY: this migration only ADDS. It creates one generated column and one
-- index. It does not modify, delete, or rewrite any existing value — the 614
-- rows, including the 338 curated summaries protected by
-- manually_edited_fields, are read to build the column and are otherwise
-- untouched. It is reversible by dropping the two objects it creates.
--
-- COST: Postgres computes the column for every existing row once, while this
-- runs. On 614 rows (~2MB of full_text) that is a few seconds, during which
-- writes to executive_orders wait. The nightly cron jobs run at 10:30 UTC;
-- applying this well away from that window avoids contending with them.

-- A "tsvector" is Postgres's pre-chewed form of a document: the text reduced
-- to normalized search terms with their positions. Matching against it is
-- what makes full-text search fast, and it is what gives us word stemming
-- ("tariffs" finds "tariff") and Google-style query syntax for free.
--
-- GENERATED ALWAYS ... STORED means Postgres maintains this itself on every
-- insert and update. There is no trigger to forget and no application code
-- that can leave it stale — including the nightly enrichment job, which will
-- keep it current for free when it writes a summary.
--
-- setweight() ranks where a term was found. 'A' is the strongest: a hit in
-- the title outranks one buried in the body, which is what makes the
-- relevance sort meaningful rather than arbitrary.
alter table executive_orders
  add column if not exists search_vector tsvector
  generated always as (
    setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(eo_number, '')), 'A') ||
    setweight(to_tsvector('english', coalesce(action_type, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(array_to_string(subject_area, ' '), '')), 'B') ||
    setweight(to_tsvector('english', coalesce(ai_summary, '')), 'B') ||
    setweight(to_tsvector('english', coalesce(full_text, '')), 'D')
  ) stored;

-- GIN is the index type built for "which rows contain this term" questions.
-- Without it Postgres still answers correctly, just by reading every row —
-- which is exactly the 1.5-2s measured above.
create index if not exists executive_orders_search_vector_idx
  on executive_orders using gin (search_vector);

-- The tracker's default ordering, and the tie-breaker when relevance ties.
-- Paging with ORDER BY on an unindexed column re-sorts the whole table for
-- every page; this makes each page a cheap index read instead.
create index if not exists executive_orders_date_signed_idx
  on executive_orders (date_signed desc nulls last);

-- Filtering by practice area and industry is an array-containment test, which
-- GIN also serves. Without these, every filtered page scans the full table.
create index if not exists executive_orders_practice_areas_idx
  on executive_orders using gin (practice_areas);
create index if not exists executive_orders_industries_idx
  on executive_orders using gin (industries);

-- No RLS or grant changes: search_vector rides along on executive_orders,
-- whose policies (0001, loosened by 0002) already govern who can read it.
