# Sheppard EO Tracker

An internal tool that tracks executive orders (EOs) from the current administration
(Jan 20, 2025 onward), enriches them with AI-generated summaries and firm-specific
tagging, tracks related litigation and news, and helps attorneys draft client alerts,
blog posts, talking points, and social posts grounded in that data.

This replaces a manually-maintained spreadsheet. See the project plan discussed with
the team for full background and the phased roadmap — this repo currently implements
**Phase 1: foundation** (data model, tracker UI, content-drafting UI, real seed data),
with automation (Phases 2–5) still to come.

## Current status — what's live vs. stubbed

| Piece | Status |
|---|---|
| Tracker table + EO detail pages | ✅ Working, showing real imported data (see below) |
| Content-drafting UI (all 4 content types, single & multi-EO) | ✅ Working UI; generates **stub text** until `ANTHROPIC_API_KEY` is set |
| Copy / .docx / markdown export | ✅ Working |
| Firm spreadsheet import | ✅ Done — 340 executive actions imported (see below) |
| Supabase data model (schema + RLS) | ✅ Written (`supabase/migrations/0001_init.sql`), not yet connected to a live project |
| Supabase bulk-import script | ✅ Written (`npm run import:supabase`), not yet run against a live project |
| Federal Register ingestion (automated EO discovery) | ❌ Not built yet (Phase 2) |
| AI tagging pipeline (Subject Area / Practice Areas / Industries) | ❌ Not built yet (Phase 2) — schema and fixed lists are in place |
| Litigation / news sweep (CourtListener + free news search) | ❌ Not built yet (Phase 3) |
| Email digest | ❌ Not built yet (Phase 5) |
| Auth / admin vs. general user roles | ❌ Not built yet (Phase 5) — RLS policies for it already exist in the schema |

Until Supabase is connected, the app reads its data straight from
`src/data/legacy-import/*.json` (see "Where the data comes from" below) — this is what
you'll see when you run it locally right now: real firm data, not placeholders.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000. No environment variables are required — the tracker and
content-drafting UI work immediately against the imported data.

## Where the data comes from

The firm's original tracker — `Trump_Administration_Executive_Actions_Tracker_Sheppard_Mullin.xlsx`
(maintained through Jan 20, 2026) — is checked into the repo at
`data/source/trump-admin-executive-actions-tracker.xlsx`. Three sheets were extracted:

| Source sheet | Rows | Imported as | Used in the app today |
|---|---|---|---|
| "Trump Admin Exec Actions" | 340 | `src/data/legacy-import/executive-orders.json` | ✅ Tracker + detail pages + content drafting |
| "Rescinded Exec Actions" | 112 | `src/data/legacy-import/rescinded-prior-orders.json` | Data ready (`getRescindedPriorOrders()` in `src/lib/data.ts`); no UI page yet |
| "Select Agency Actions" | 32 | `src/data/legacy-import/agency-actions.json` | Data ready (`getAgencyActions()` in `src/lib/data.ts`); no UI page yet |

`scripts/import_legacy_tracker.py` (Python, `pip install openpyxl` if needed) does the
extraction — re-run it (`npm run import:legacy`) if you replace the source file with a
fresher export. It parses each row's free-text "Type/Number" column into a structured
`actionType` ("Executive Order", "Proclamation", "Memorandum", ...) plus, for true EOs,
an `eoNumber` like `"EO 14351"`; splits multi-value cells (agencies impacted, legal
challenges) into arrays; and marks firm-authored fields (summary, deliverable, timeline,
legal challenges, etc.) as `manuallyEditedFields` so a future automated enrichment pass
won't silently overwrite them.

### Known data quality issues (inherited from the source spreadsheet)

- **A handful of EO numbers appear on two different rows** with different titles/content
  (e.g. `EO 14360`, `EO 14232`) — most likely data-entry inconsistencies in the original
  tracker. Both rows were preserved as-is rather than guessing which is correct; the
  database schema deliberately does **not** enforce uniqueness on `eo_number` because of
  this. Worth reconciling against the Federal Register once Phase 2 ingestion is live.
- A few rows have ambiguous type/number text (e.g. a bare EO number with no "EO" prefix,
  "not posted to Fed. Reg. yet") — handled with best-effort parsing in the import script;
  spot-check `actionType`/`eoNumber` on those if precision matters for your use case.

## Environment variables

Create a `.env.local` file (never commit it) to connect real services:

```bash
# Supabase — moves off the local JSON files onto a live, shared database
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
# Only needed to run `npm run import:supabase` (one-time seed import)
SUPABASE_SERVICE_ROLE_KEY=

# Anthropic — enables real AI-generated content instead of stub drafts
ANTHROPIC_API_KEY=
# Optional: override the model used for content generation (defaults to claude-opus-5)
EO_TRACKER_MODEL=
```

### Setting up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql` — this creates the
   `executive_orders`, `rescinded_prior_orders`, `agency_actions`, `content_drafts`,
   `profiles`, and `ingestion_runs` tables along with row-level security policies for
   the admin/general user split.
3. Copy the project URL, anon key, and service role key into `.env.local` as above.
4. Run `npm run import:supabase` **once** to load the real imported data into the fresh
   database (see the script's header comment — it inserts fresh rows every run, so only
   run it against an empty table).
5. Restart the dev server — the tracker now reads/writes Supabase instead of the local
   JSON files.

## Firm-specific tagging lists

Sheppard's Practice Areas and Industries lists (used for AI tagging) live in:

- `src/config/practice-areas.json`
- `src/config/industries.json`

Edit these files directly if the firm's list changes — nothing else in the app needs
to change.

## Project structure

```
data/
  source/                   The firm's original tracker spreadsheet (checked in for provenance)
scripts/
  import_legacy_tracker.py  Extracts the spreadsheet into src/data/legacy-import/*.json
  import-to-supabase.ts     One-time bulk load of that JSON into a connected Supabase project
src/
  app/
    page.tsx              Tracker dashboard (table + filters)
    eo/[id]/page.tsx       EO detail page
    draft/page.tsx         Content-drafting assistant
    api/generate-content/  Content generation API route (stub or real, per ANTHROPIC_API_KEY)
  components/              UI components (table, tags, status badges, drafter, header)
  config/                  Fixed Practice Areas / Industries lists
  data/legacy-import/      Extracted spreadsheet data (generated — see scripts/ above)
  lib/
    types.ts               Shared TypeScript types (mirrors the SQL schema)
    supabase.ts             Supabase client factory (returns null if unconfigured)
    data.ts                 Data access layer — Supabase if configured, else local JSON
    taxonomy.ts              Typed accessors for the Practice Area / Industry config
    content-generation.ts    Prompt construction + Claude API call for drafting
supabase/
  migrations/0001_init.sql  Full schema, indexes, and RLS policies
```

## Next steps (in rough order)

1. Connect a Supabase project (see above) and confirm the tracker reads/writes it.
   Note: `src/app/page.tsx` is currently statically prerendered at build time since it
   has no dynamic data source yet — once real Supabase data is flowing, mark it dynamic
   (`export const dynamic = "force-dynamic"`, or add revalidation) so new EOs show up
   without a full rebuild.
2. Build the Federal Register ingestion job (Phase 2) and the AI tagging pipeline that
   populates Subject Area / Practice Areas / Industries / summary on new EOs going
   forward (the imported 340 already have firm-authored summaries and subject areas).
3. Build the CourtListener + news sweep (Phase 3).
4. Add auth (Supabase Auth) with the admin/general role split the schema already
   supports, and the email digest (Phase 5).
5. Optionally build UI pages for the Rescinded Prior Orders and Agency Actions data
   (imported and available via `src/lib/data.ts`, but not surfaced in the UI yet).
