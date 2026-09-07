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
| Copy / .docx / markdown export | ✅ Working, gated behind a "reviewed for accuracy" confirmation |
| Interim shared-password access gate | ✅ Working (`SITE_PASSWORD` env var) — see "Interim access" below |
| Firm spreadsheet import | ✅ Done — 340 executive actions imported (see below) |
| Supabase data model (schema + RLS) | ✅ Written (`supabase/migrations/0001_init.sql`), not yet connected to a live project |
| Supabase bulk-import script | ✅ Written (`npm run import:supabase`), not yet run against a live project |
| Federal Register ingestion (automated EO/Proclamation/Memorandum discovery) | ✅ Built (Phase 2) — see "Federal Register ingestion" below. Not yet run against a live project (waiting on Supabase connection above) |
| AI tagging pipeline (Subject Area / Practice Areas / Industries) | ✅ Built as part of Phase 2's enrich job — decoupled from ingestion, its own schedule |
| Content-drafter quote verification | ✅ Built — flags any quoted text in a generated draft that doesn't appear verbatim in the source order(s) |
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
  These records are flagged with a visible "⚠ Needs review" badge in the UI
  (`flagDuplicateEoNumbers` in `src/lib/data.ts`, computed fresh on every fetch — it
  self-corrects once the underlying duplicates are fixed).
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

# Optional: gates the whole app behind a single shared password (see "Interim
# access before real auth" below). Leave unset for local development.
SITE_PASSWORD=

# Required in production once the /api/cron/* jobs are scheduled (see
# "Federal Register ingestion" below) — generate with `openssl rand -hex 32`.
CRON_SECRET=
```

### Setting up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. In the SQL Editor, run `supabase/migrations/0001_init.sql`, then
   `0002_loosen_read_policies.sql`, **in that order** — this creates the
   `executive_orders`, `rescinded_prior_orders`, `agency_actions`, `content_drafts`,
   `profiles`, and `ingestion_runs` tables along with row-level security policies
   (`0002` loosens the four tables the app's anon client reads directly to
   `using (true)` for this pre-Phase-5 phase — see CLAUDE.md's "Resolved — RLS
   anon-read gap" for why).
3. Copy the project URL, anon key, and service role key into `.env.local` as above.
4. Run `npm run import:supabase` **once** to load the real imported data into the fresh
   database (see the script's header comment — it inserts fresh rows every run, so only
   run it against an empty table).
5. Restart the dev server — the tracker now reads/writes Supabase instead of the local
   JSON files.

### Interim access before real auth

There's no user accounts system yet (that's Phase 5). If you want a few colleagues to try
the tool before then, set `SITE_PASSWORD` in the deployment's environment variables — the
whole app (via `src/proxy.ts`) redirects anyone without the right cookie to `/gate`, a
single shared-password prompt. This is **not** a real accounts system — no per-user
identity, no roles — just enough to keep a deployed URL from being fully open. Leave it
unset for local development. Remove `src/proxy.ts`, `src/app/gate/`, `src/app/api/gate/`,
and `src/lib/site-auth.ts` once Supabase Auth ships.

## Federal Register ingestion

Once Supabase is connected, three independent jobs keep `executive_orders` in
sync with [federalregister.gov's API](https://www.federalregister.gov/developers/documentation/api/v1)
(no key required — see `src/lib/federal-register/`):

- **`ingest`** (daily, `/api/cron/ingest`) — re-checks the trailing 90-day
  publication window for new documents and corrections. "New" is
  existence-based (an unseen `document_number`), not date-based — the window
  just keeps each run's query cheap.
- **`enrich`** (daily, `/api/cron/enrich`) — fully decoupled from ingestion.
  Summarizes and tags ~20 orders per run (conservative, to control Anthropic
  cost), verifying any quoted text against the order's stored `full_text` in
  code before saving — a summary with an unverifiable quote is never saved;
  the row is flagged for review instead.
- **`reconcile`** (weekly, `/api/cron/reconcile`) — a cheap
  `document_number`-only diff against the API over the *full*
  administration-to-date range, so a gap older than the daily job's window
  doesn't silently persist. Logged as its own run type so a completeness gap
  is never confused with an ingestion failure.

All three are Vercel Cron jobs (see `vercel.json`), authenticated via
`CRON_SECRET` (see `.env.example`) — never open endpoints.

**Corrections** are merged into the row they correct (matched via the
correction's `correction_of` field, falling back to `eo_number` for
multi-hop correction chains), never inserted as a new row. If a correction
would change a field already in `manually_edited_fields`, it's left alone
and the row is flagged instead — an attorney's correction is never silently
overwritten by a government correction.

**One-time historical backfill** (`npm run backfill:federal-register`, run
locally — never as a Vercel Cron endpoint, since it has no timeout to
respect) pulls everything from January 20, 2025 through today, reconciling
the 340 legacy rows by `eo_number` (flagging, not guessing, when a match
doesn't line up confidently — see `KNOWN_DUPLICATE_EO_NUMBERS` in the
script for the 4 rows never auto-reconciled).

**Needs Attention** (`/needs-attention` in the app) shows every flagged row
and recent run history — the only place any of this is actually visible
day to day.

**A note on source reliability**: FederalRegister.gov states its own text is
["not an official legal edition"](https://www.federalregister.gov/reader-aids/government-policy-and-ofr-procedures/about-this-site#legal-status) —
the official version is the linked govinfo.gov PDF (`federal_register_url`
on each order). Fine for summarization and drafting; anywhere content is
asserted as authoritative, cite the PDF.

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
  import_legacy_tracker.py       Extracts the spreadsheet into src/data/legacy-import/*.json
  import-to-supabase.ts          One-time bulk load of that JSON into a connected Supabase project
  backfill-federal-register.ts   One-time Federal Register historical backfill (run locally)
src/
  app/
    page.tsx                Tracker dashboard (table + filters)
    eo/[id]/page.tsx         EO detail page
    draft/page.tsx           Content-drafting assistant
    needs-attention/page.tsx Flagged rows + recent ingestion run history
    api/generate-content/    Content generation API route (stub or real, per ANTHROPIC_API_KEY)
    api/cron/                Federal Register ingest/enrich/reconcile jobs (Vercel Cron, CRON_SECRET-gated)
  components/                UI components (table, tags, status badges, drafter, header)
  config/                    Fixed Practice Areas / Industries lists
  data/legacy-import/        Extracted spreadsheet data (generated — see scripts/ above)
  lib/
    types.ts                 Shared TypeScript types (mirrors the SQL schema)
    supabase.ts               Supabase client factories (anon; service-role for ingestion)
    data.ts                   Data access layer — Supabase if configured, else local JSON
    taxonomy.ts                Typed accessors for the Practice Area / Industry config
    content-generation.ts      Prompt construction + Claude API call for drafting
    cron-auth.ts                Verifies a request came from Vercel Cron (CRON_SECRET)
    federal-register/           Federal Register API client, sync/ingest/enrich/reconcile logic
supabase/
  migrations/0001_init.sql  Full schema, indexes, and RLS policies
  migrations/0002_loosen_read_policies.sql  Loosens anon-client SELECT policies (see CLAUDE.md)
vercel.json                 Cron schedules for the three /api/cron/* jobs
```

## Next steps (in rough order)

1. Connect a Supabase project (see above) and confirm the tracker reads/writes it.
   Note: `src/app/page.tsx` is currently statically prerendered at build time since it
   has no dynamic data source yet — once real Supabase data is flowing, mark it dynamic
   (`export const dynamic = "force-dynamic"`, or add revalidation) so new EOs show up
   without a full rebuild. (`src/app/needs-attention/page.tsx` already does this.)
2. Run `npm run backfill:federal-register` once against the freshly-connected database
   (see "Federal Register ingestion" above), then set `CRON_SECRET` in Vercel so the
   three scheduled jobs in `vercel.json` can authenticate.
3. Build the CourtListener + news sweep (Phase 3).
4. Add auth (Supabase Auth) with the admin/general role split the schema already
   supports, and the email digest (Phase 5).
5. Optionally build UI pages for the Rescinded Prior Orders and Agency Actions data
   (imported and available via `src/lib/data.ts`, but not surfaced in the UI yet).
