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
| Content-drafting UI (all 4 content types, single & multi-EO) | ✅ Working UI; generates **stub text** until `AI_GATEWAY_API_KEY` or `ANTHROPIC_API_KEY` is set |
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

# AI credentials — enables real AI-generated content instead of stub drafts.
# Set ONE of these; the gateway key wins if both are present.
#   AI_GATEWAY_API_KEY — routes Claude calls through Vercel's AI Gateway
#     (https://ai-gateway.vercel.sh), so spend and traffic are visible in the
#     Vercel dashboard. Create the key under AI Gateway > API Keys.
#   ANTHROPIC_API_KEY  — calls the Anthropic API directly.
AI_GATEWAY_API_KEY=
ANTHROPIC_API_KEY=
# Optional: override the model used for content drafting (defaults to
# claude-opus-5). Write it either bare ("claude-opus-5") or gateway-style
# ("anthropic/claude-opus-5") — the prefix is added or stripped to match
# whichever route is in use.
EO_TRACKER_MODEL=
# Optional: override the model used to summarize and classify Federal
# Register documents (defaults to claude-fable-5). Separate from the drafting
# model so the two can be priced and tuned independently.
EO_TRACKER_SUMMARY_MODEL=

# Optional: gates the whole app behind a single shared password (see "Interim
# access before real auth" below). Leave unset for local development.
SITE_PASSWORD=

# Required in production once the /api/cron/* jobs are scheduled (see
# "Federal Register ingestion" below) — generate with `openssl rand -hex 32`.
CRON_SECRET=

# Optional: a free CourtListener API token (courtlistener.com > Profile >
# API tokens). `npm run link:dockets` works without it, but anonymous callers
# are rate-limited hard — roughly 25 requests before a 429 — so a full run
# takes longer and leans on the client's backoff. Costs nothing either way.
COURTLISTENER_API_TOKEN=
```

### Setting up Supabase

**This project is already connected** (see CLAUDE.md's "Supabase project is
connected" section for the live project ref, current env var state, and an
important note: this project's GitHub integration auto-deploys
`supabase/migrations/` on every push to the production branch — a new
migration is applied the moment it's pushed, not when someone later runs it
by hand). The steps below are what a fresh project setup looks like from
scratch.

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

The three fixed lists the AI must choose from live in:

- `src/config/practice-areas.json` — each entry also carries a one-line `criteria`
  string telling the model when that group should be selected
- `src/config/industries.json`
- `src/config/subject-areas.json` — the 26 topics derived from the values the firm
  actually used across the 340 hand-curated rows of the original spreadsheet

Edit these files directly if the firm's lists change — nothing else in the app needs
to change. They are deliberately kept in code rather than in the editable prompt:
`parseSummaryResponse` validates the model's answers against these same lists and
silently drops anything off-list, so a hand-typed copy inside the prompt could drift
and make valid selections disappear.

## The summarization prompt

The instructions sent to the model for every summary are **editable in the app at
`/prompt`** — no deploy needed. Each save is a new version in the `summary_prompts`
table; the version in force is shown, past versions are kept and readable, and
"Reset to default" restores the built-in starting prompt
(`src/lib/summary-prompt/default-prompt.ts`).

That default was derived from the firm's own 340 hand-written summaries rather than
written from scratch — median 67 words, one paragraph, descriptive not evaluative,
openings like "This EO directs…" — and carries four of them as worked examples.

A saved prompt is checked before it's accepted: one that stops asking for the
required JSON keys is refused outright (it would fail on every row of the next
nightly run), and one that drops a `{{...}}` taxonomy placeholder saves with a
warning explaining what will come back empty.

**Editing the prompt never rewrites existing summaries.** It applies to rows
summarized after the save.

### Summarizing the whole backlog at once

`npm run enrich:all` works the enrichment queue down to empty in one sitting
instead of waiting out the cron's 20 rows a night. Dry-run by default (counts
and prices the queue, calls no model); `-- --apply` runs it, `-- --apply
--max-cost N` changes the spend cap (default $30).

Safe to interrupt and safe to re-run: each pass selects only rows where
`ai_summary IS NULL`, so stopping — by Ctrl-C, the spend cap, or running out
of API credit — leaves finished rows finished and resumes from there. It also
stops on its own if a full pass summarizes nothing, so a systematic failure
can't loop burning money.

## What the API costs

Every model call is recorded in `api_usage` (migration 0006) with its tokens
and its cost, and **`/usage`** totals it by UTC day — the same basis the
provider bills on — with a per-feature breakdown and a 30-day table.

Cost is computed at call time from the rate table in
`src/lib/usage/pricing.ts` and stored, so an upstream price change never
rewrites what past runs cost. That table is a hardcoded snapshot: check it
against Anthropic's pricing page if a total looks wrong. A model missing from
it records as *unpriced* rather than free, and the page says so.

The summarization system prompt is cached (`cache_control: ephemeral`),
which is why `/usage` breaks out cache-read tokens: they bill at a tenth the
input rate, and if that column reads 0 during a run, caching has silently
stopped and the bill is roughly double what it should be.

### Drafting against the curated rows

`npm run draft:summaries` writes AI drafts for rows that *already* have the firm's
hand-written summary, into `summary_drafts`, leaving `ai_summary` untouched. Each
EO's detail page then shows the draft beneath the curated text for comparison.
Run it dry first (no flag) to see how many rows qualify without spending anything;
`-- --apply` drafts them, `-- --apply --limit N` controls how many. It is
deliberately a manual script rather than a cron job, since every row is a
full-text model call.

## Legal challenges — linking cases to real dockets

The firm's spreadsheet recorded challenges as a case name and a court, with
no link: 252 entries across 37 orders, none of them clickable. `npm run
link:dockets` finds the matching docket on
[CourtListener](https://www.courtlistener.com) (the Free Law Project's
mirror of federal PACER records) and attaches the real docket number, filing
date and URL.

**It never guesses.** A docket is attached only when the case name matches
exactly, in the court the firm recorded, filed on a date that makes sense for
that order, and no other docket also fits. Everything else gets one of two
other outcomes:

| Outcome | What it means | What happens |
|---|---|---|
| `confident` | One exact match, right court, no rival | Linked automatically |
| `ambiguous` | Several plausible dockets, or the court is missing/unrecognized | Written to the review file for a human to choose |
| `not_found` | No docket carries that name in that court | Left empty — the case may have been renamed, or may not be in RECAP |

That three-way split is deliberate. For a law firm a wrong docket link is
worse than an empty cell, so "probably this one" is not an outcome the
matcher can produce. There are genuinely two different `Doe v. Noem` cases
in D. Mass., and filtering by court does not separate them.

No model is called at any point and CourtListener's search API is free, so a
run costs nothing.

```bash
npm run link:dockets              # dry run: searches, writes the review file, changes nothing
npm run link:dockets -- --apply   # writes confident matches and your resolved choices
```

**Resolving an ambiguous entry**: open `data/legal-challenge-links.json`,
find the entry, pick the right docket from its `candidates`, copy that
candidate's `docketId` into the entry's `chosenDocketId`, and re-run with
`--apply`. Choices survive re-runs, and the file is committed so the record
of what was linked — and on what basis — lives in git.

Applying a link only ever *adds* fields to an entry; the case name, court,
status and summary the firm wrote are left exactly as they are, and a
`docketUrl` already present is never overwritten. Each added link carries a
`linkSource` and `linkedAt` stamp so a matched link can be told apart from a
hand-entered one.

## Project structure

```
data/
  source/                   The firm's original tracker spreadsheet (checked in for provenance)
  legal-challenge-links.json  Docket-matching results + the review queue (generated; committed on purpose)
scripts/
  import_legacy_tracker.py       Extracts the spreadsheet into src/data/legacy-import/*.json
  import-to-supabase.ts          One-time bulk load of that JSON into a connected Supabase project
  backfill-federal-register.ts   One-time Federal Register historical backfill (run locally)
  link-dockets.ts                Links recorded legal challenges to real CourtListener dockets
  generate-court-ids.ts          Regenerates the court lookup from CourtListener's own /courts/ API
src/
  app/
    page.tsx                Tracker dashboard (table + filters)
    eo/[id]/page.tsx         EO detail page
    draft/page.tsx           Content-drafting assistant
    needs-attention/page.tsx Flagged rows + recent ingestion run history
    api/generate-content/    Content generation API route (stub or real, per the AI credentials)
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
    courtlistener/              CourtListener docket search + the deterministic case-matching gate
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
