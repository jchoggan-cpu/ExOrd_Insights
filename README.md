# Sheppard EO Tracker

An internal tool that tracks executive orders (EOs) from the current administration
(Jan 20, 2025 onward), enriches them with AI-generated summaries and firm-specific
tagging, tracks related litigation and news, and helps attorneys draft client alerts,
blog posts, talking points, and social posts grounded in that data.

This replaces a manually-maintained spreadsheet. See the project plan discussed with
the team for full background and the phased roadmap — this repo currently implements
**Phase 1: foundation** (data model, tracker UI, content-drafting UI), with automation
(Phases 2–5) still to come.

## Current status — what's live vs. stubbed

| Piece | Status |
|---|---|
| Tracker table + EO detail pages | ✅ Working, using sample placeholder data |
| Content-drafting UI (all 4 content types, single & multi-EO) | ✅ Working UI; generates **stub text** until `ANTHROPIC_API_KEY` is set |
| Copy / .docx / markdown export | ✅ Working |
| Supabase data model (schema + RLS) | ✅ Written (`supabase/migrations/0001_init.sql`), not yet connected to a live project |
| Federal Register ingestion (automated EO discovery) | ❌ Not built yet (Phase 2) |
| AI tagging pipeline (Subject Area / Practice Areas / Industries) | ❌ Not built yet (Phase 2) — schema and fixed lists are in place |
| Litigation / news sweep (CourtListener + free news search) | ❌ Not built yet (Phase 3) |
| Email digest | ❌ Not built yet (Phase 5) |
| Auth / admin vs. general user roles | ❌ Not built yet (Phase 5) — RLS policies for it already exist in the schema |
| Spreadsheet import (seed data) | ❌ Not built yet — see "Importing your spreadsheet" below |

Until Supabase is connected, the app runs entirely on the sample data in
`src/data/sample-executive-orders.ts` (clearly labeled `SAMPLE-EO-*`) — this is what
you'll see when you run it locally right now.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. No environment variables are required to see the tracker
and content-drafting UI working against sample data.

## Environment variables

Create a `.env.local` file (never commit it) to connect real services:

```bash
# Supabase — connects real data instead of sample data
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=

# Anthropic — enables real AI-generated content instead of stub drafts
ANTHROPIC_API_KEY=
# Optional: override the model used for content generation (defaults to claude-opus-5)
EO_TRACKER_MODEL=
```

### Setting up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql` — this creates the
   `executive_orders`, `content_drafts`, `profiles`, and `ingestion_runs` tables along
   with row-level security policies for the admin/general user split.
3. Copy the project URL and anon key into `.env.local` as above.
4. Restart the dev server — the tracker will now read/write real data instead of the
   sample set (once you've imported or ingested some).

## Firm-specific tagging lists

Sheppard's Practice Areas and Industries lists (used for AI tagging) live in:

- `src/config/practice-areas.json`
- `src/config/industries.json`

Edit these files directly if the firm's list changes — nothing else in the app needs
to change.

## Importing your spreadsheet

Not yet built. The plan is: export the existing Google Sheet as CSV, then run a
one-time import script that maps its columns (Subject Area, Title, Key Date(s),
Type/Number, Agency(-ies) Impacted, Summary, Timeline, Deliverable, Available
Analysis, Legal Challenges) onto the `executive_orders` table, so existing manual
curation isn't lost. This is next up — see the project plan.

## Project structure

```
src/
  app/
    page.tsx              Tracker dashboard (table + filters)
    eo/[id]/page.tsx       EO detail page
    draft/page.tsx         Content-drafting assistant
    api/generate-content/  Content generation API route (stub or real, per ANTHROPIC_API_KEY)
  components/              UI components (table, tags, status badges, drafter, header)
  config/                  Fixed Practice Areas / Industries lists
  data/                    Sample placeholder data
  lib/
    types.ts               Shared TypeScript types (mirrors the SQL schema)
    supabase.ts             Supabase client factory (returns null if unconfigured)
    data.ts                 Data access layer — Supabase if configured, else sample data
    taxonomy.ts              Typed accessors for the Practice Area / Industry config
    content-generation.ts    Prompt construction + Claude API call for drafting
supabase/
  migrations/0001_init.sql  Full schema, indexes, and RLS policies
```

## Next steps (in rough order)

1. Build the spreadsheet CSV import script and seed real data.
2. Connect a Supabase project (see above) and confirm the tracker reads/writes it.
   Note: `src/app/page.tsx` is currently statically prerendered at build time since it
   has no dynamic data source yet — once real Supabase data is flowing, mark it dynamic
   (`export const dynamic = "force-dynamic"`, or add revalidation) so new EOs show up
   without a full rebuild.
3. Build the Federal Register ingestion job (Phase 2) and the AI tagging pipeline that
   populates Subject Area / Practice Areas / Industries / summary on new EOs.
4. Build the CourtListener + news sweep (Phase 3).
5. Add auth (Supabase Auth) with the admin/general role split the schema already
   supports, and the email digest (Phase 5).
