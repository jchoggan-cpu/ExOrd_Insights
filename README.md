# Sheppard EO Tracker

An internal tool that tracks executive orders (EOs) from the current administration
(Jan 20, 2025 onward), enriches them with AI-generated summaries and firm-specific
tagging, tracks related litigation and news, and helps attorneys draft client alerts,
blog posts, talking points, and social posts grounded in that data.

This replaces a manually-maintained spreadsheet. Phases 1 and 2 are live (data model,
tracker UI, content drafting, Federal Register ingestion, AI summarization and
tagging); Phase 3 is partly built (litigation dockets yes, news no); Phases 4–5
(email digest, real accounts) are not started.

## Current status

Verified against the live database on 2026-09-16.

| Piece | Status |
|---|---|
| Supabase | ✅ Connected. Migrations `0001`–`0008` applied — see "Setting up Supabase" |
| Tracker table + EO detail pages | ✅ Live — **553 orders**, signed 2025-01-17 → 2026-09-09 |
| Search, multi-select filters, signing-date range | ✅ Live, executed in Postgres (`search_executive_orders`, migrations `0007`/`0008`) |
| Federal Register ingestion | ✅ Live — three Vercel Cron jobs, see "Federal Register ingestion" |
| Summaries | ✅ **All 553 rows** have one. 284 are still the firm's hand-written text (275 of those protected from automated overwrite via `manually_edited_fields`); the rest are AI-written |
| AI practice-area / industry tagging | ✅ 428 rows tagged; the untagged remainder is ceremonial, where empty is correct |
| Quote verification | ✅ A summary or draft quoting text not found verbatim in the source is never saved |
| Content-drafting UI (4 content types, single & multi-EO) | ✅ Live, producing real AI output |
| Copy / .docx / markdown export | ✅ Gated behind a "reviewed for accuracy" confirmation |
| Shared-password access gate | ✅ Live in production (`SITE_PASSWORD`) — see "Interim access" |
| Litigation docket linking (CourtListener) | ⚠️ Partly — **131 of 252** recorded challenges linked; 30 need a human decision, 91 unmatched |
| Legal-challenge *discovery* (orders with no recorded challenge) | ❌ Not started — everything so far only links cases the firm already found |
| News mentions | ❌ Not started — the `NewsMention` type exists and is unused |
| Alerting when a scheduled job fails | ❌ Not built — `/needs-attention` is the only surface, and you have to go look |
| Email digest | ❌ Not started (Phase 5) |
| Auth / admin vs. general user roles | ❌ Not started (Phase 5) — RLS policies for it already exist in the schema |

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

With no `.env.local`, the app falls back to the imported spreadsheet data in
`src/data/legacy-import/*.json` — real firm data, but a frozen January 2026
snapshot of 340 rows, and a visible banner says so. To work against the live
553-row database, set at least `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (see "Environment variables").

## Where the data comes from

Three sources feed the tracker:

| Source | What it provides | How it arrives |
|---|---|---|
| The firm's spreadsheet | The 340 hand-curated rows, including every summary and analysis an attorney wrote | One-time import, already done |
| [federalregister.gov](https://www.federalregister.gov/developers/documentation/api/v1) | Every new executive action, plus source text, citation and official URL | Daily cron — free, no API key |
| [CourtListener](https://www.courtlistener.com) | Real docket numbers, filing dates and URLs for recorded litigation | `npm run link:dockets`, by hand — free |

Of the 553 rows today, **499 carry Federal Register source text** and 54 are
legacy-only records (mostly memoranda and pardons the Federal Register never
published) that can never be fact-checked against a source.

### The original spreadsheet

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

### Known data quality issues

- **Duplicate EO numbers — resolved.** A handful of EO numbers used to appear on two
  rows with different content. Reconciling against the Federal Register cleared them;
  `npm run diagnostics` now reports 0. The schema still deliberately does **not**
  enforce uniqueness on `eo_number`, and `flagDuplicateEoNumbers`
  (`src/lib/duplicate-eo-numbers.ts`) still runs on every fetch, so a recurrence is
  flagged in the UI rather than trusted.
- **Duplicate *instruments* — resolved 2026-09-16, and worth understanding.** 62 orders
  (about one row in ten) existed twice: once from the spreadsheet, once from the
  Federal Register. The backfill matched the two sources on `eo_number`, and
  proclamations and memoranda have none, so they were inserted a second time instead of
  reconciled. Nothing flagged them, because the duplicate check also only compared EO
  numbers. They were merged with `npm run merge:duplicates` — see "Merging duplicate
  records" below, and `data/duplicate-merges.json` for exactly what was decided.
- **Three rows carry malformed `action_type` values** — two stuck at
  `"Pending Federal Register Publication"` and one reading `"Proclamation 10973"`, where
  a number leaked into the type field. All three are leftovers from parsing the
  spreadsheet's free-text "Type/Number" column, and none has a Federal Register
  counterpart to correct it. Fix by hand with `npm run correct`.
- **`key_dates` and `news_mentions` are empty on all 553 rows.** The columns and types
  exist; nothing writes to them yet.
- **Practice-area tags have no ground truth.** They are AI-generated and have never
  been validated beyond a 20-row pilot review. Treat them as a filtering aid, not an
  authority.

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
# Optional: override the model used to summarize Federal Register documents
# (defaults to claude-fable-5). Separate from the drafting model so the two
# can be priced and tuned independently.
EO_TRACKER_SUMMARY_MODEL=
# Optional: override the model used to tag practice areas and industries
# (defaults to claude-sonnet-5). Classification is its own task with its own
# model — picking labels off a fixed list does not need the tier that writes
# prose an attorney reads. Chosen by a measured bake-off: ~$5 a corpus
# against Fable 5's ~$29. See src/lib/ai-model.ts.
EO_TRACKER_CLASSIFY_MODEL=

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
2. In the SQL Editor, run every file in `supabase/migrations/` **in filename order**,
   `0001_init.sql` through `0008_multi_select_and_date_filters.sql`. In summary:
   `0001` creates the tables and RLS policies; `0002` loosens the four SELECT policies
   the anon client reads (see CLAUDE.md's "Resolved — RLS anon-read gap"); `0003` fixes
   a Postgres-level grant gap; `0004` reconciles schema drift; `0005` adds the editable
   prompt and summary drafts; `0006` adds API usage metering; `0007`/`0008` add the
   full-text search index and the `search_executive_orders` function the tracker's
   search, filters and paging all run through.
3. Copy the project URL, anon key, and service role key into `.env.local` as above.
4. Run `npm run import:supabase` **once** to load the real imported data into the fresh
   database (see the script's header comment — it inserts fresh rows every run, so only
   run it against an empty table).
5. Restart the dev server — the tracker now reads/writes Supabase instead of the local
   JSON files.

### Interim access before real auth

There's no user accounts system yet (that's Phase 5). Until then, `SITE_PASSWORD` in the
deployment's environment variables gates the whole app: `src/proxy.ts` redirects anyone
without the right cookie to `/gate`, a single shared-password prompt. **This is live in
production.** It is **not** a real accounts system — no per-user identity, no roles —
just enough to keep a deployed URL from being fully open. Leave it unset for local
development. Remove `src/proxy.ts`, `src/app/gate/`, `src/app/api/gate/`, and
`src/lib/site-auth.ts` once Supabase Auth ships.

Two things worth knowing about it:

- **It needs no paid Vercel plan.** Vercel's own Deployment Protection is a paid add-on;
  this is the app's own gate, and `SITE_PASSWORD` is an ordinary environment variable
  that works on Hobby.
- **`/api/cron/*` is deliberately excluded** from the proxy's matcher. Vercel Cron sends
  a plain GET expecting JSON, not a redirect to an HTML login page, so those routes are
  protected by `CRON_SECRET` instead. If you change the matcher, re-check that a cron
  request still returns JSON and an unauthenticated one still returns 401 — not the gate.

## Federal Register ingestion

Three independent jobs keep `executive_orders` in
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
script for the 4 rows never auto-reconciled). **Already run.**

**The duplicate guard** (`src/lib/federal-register/find-unlinked-legacy.ts`) is
what stops ingestion inserting a second row for an order the firm already
recorded. Before inserting anything new, it looks for an unlinked legacy row
matching on `eo_number` first, then on normalized title plus signing date; a
match flags that row for review rather than duplicating it, and rather than
linking it — linking is the backfill's job, and it applies its own confidence
checks. The title-and-date half is not optional: without it the guard never
ran at all for proclamations and memoranda, which have no EO number, and that
is exactly how 62 duplicates came to exist.

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

- `src/config/practice-areas.json` — each entry carries a one-line `criteria` string
  telling the model when that group should be selected. `Governmental` additionally
  carries `subPractices`, the firm's nine subgroups, each with its own criteria
- `src/config/industries.json`
- `src/config/subject-areas.json` — the 26 topics derived from the values the firm
  actually used across the 340 hand-curated rows of the original spreadsheet

Edit these files directly if the firm's lists change — nothing else in the app needs
to change. They are deliberately kept in code rather than in the editable prompt:
`parseSummaryResponse` validates the model's answers against these same lists and
silently drops anything off-list, so a hand-typed copy inside the prompt could drift
and make valid selections disappear.

**Subgroups are stored as `Governmental--National Security`**, parent and child joined
by a double hyphen. Two consequences, both load-bearing:

- The tracker's filter must understand the separator, or selecting the parent matches
  almost nothing. `search_executive_orders` (migration `0008`) matches a selected
  parent against itself **or** any of its subgroups. **Any future compound tag scheme
  has to update that function too** — introducing this separator silently broke the
  filter until `0008` fixed it.
- Which form wins when the model returns both is enforced in
  `src/lib/classify/classify-document.ts`, not in the prompt. A bare parent alongside
  one of its own subgroups is dropped, and a standalone area duplicated as a subgroup
  loses to the subgroup. The pilot proved the model returns both forms even when
  explicitly asked not to.

## Practice-area and industry tagging

`npm run classify` writes `practice_areas` and `industries` — **and nothing else**.
That separation is the whole point of `src/lib/classify/` existing alongside
`summarize.ts`: hundreds of the tracker's summaries are the firm's own curated text
(284 today), and re-tagging the corpus must not be able to touch them.

```bash
npm run classify                    # dry run: counts and prices the work, calls no model
npm run classify -- --apply         # tags rows
```

It runs on Claude Sonnet 5 rather than the summarization model — see
`EO_TRACKER_CLASSIFY_MODEL` above for why, and `src/lib/ai-model.ts` for the
measurements behind the choice.

Two things learned doing this the first time, worth not re-learning:

- **Loose criteria cost more than model choice.** Tightening the Litigation and Tax
  criteria moved the average from 2.40 tags a row to 1.95 with the model held constant.
  Fix the criteria before paying to apply them 600 times.
- **A tag on most of the corpus cannot filter.** `Governmental` reached 70% of rows,
  which is why it is subdivided. The largest single tag is now 36%.

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
input rate, and if that column reads 0 during a **bulk** run, caching has
silently stopped and the bill is roughly double what it should be. Zero on a
one- or two-row nightly cron run is normal, not a warning — an ephemeral
cache lives about five minutes, so a job that makes a single call never gets
to read one back.

**All-time spend to 2026-09-16: $24.69** — $16.18 summarizing, $8.51
classifying (including two bake-off pilots). Two things that cost more than
expected the first time: estimating from a handful of calls is unreliable
(six calls projected $8–9 against an actual $15.98), and `/usage` records
what this app has **spent**, never the remaining balance. Only the Anthropic
Console shows that, and auto-reload means a balance can quietly refill.

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

**Current state: 131 linked, 30 ambiguous, 91 not found.** The 30 ambiguous ones are
waiting on a human — see "Resolving an ambiguous entry" below. The 91 unmatched have
three diagnosed causes, in order of size: captions that differ by more than formatting
(defendant substitution is routine — Noem replaced Mayorkas); cases the firm recorded
against a district court that CourtListener holds only at the appellate level; and
plaintiff-name truncation ("Amica Center" for "Amica Center for Immigrant Rights").
Searching without the court filter and reporting the results as ambiguous would
probably recover a chunk of them, but that needs a design conversation first.

Note the scope: this links cases **the firm already found**. Discovering challenges
against the 516 orders with none recorded is a separate, unbuilt problem, and a harder
one — searching CourtListener for "Executive Order 14165" returns dozens of results
including a criminal prosecution and a land condemnation, so the verification gate
matters more than the retrieval.

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
  source/                        The firm's original tracker spreadsheet (checked in for provenance)
  legal-challenge-links.json     Docket-matching results + the review queue (generated; committed on purpose)
  duplicate-merges.json          What the 62-duplicate merge did, field by field (generated; committed)
  data-corrections.json          Log of every manual data fix, with the previous value verbatim
  original-summaries-snapshot.json  The firm's 337 curated summaries, frozen before any AI pass
scripts/
  import_legacy_tracker.py       Extracts the spreadsheet into src/data/legacy-import/*.json
  import-to-supabase.ts          One-time bulk load of that JSON into a connected Supabase project
  backfill-federal-register.ts   One-time Federal Register historical backfill (run locally)
  enrich-all.ts                  Works the summarization queue down to empty in one sitting
  classify-tags.ts               Writes practice areas and industries only — never a summary
  draft-summaries.ts             AI drafts alongside curated summaries, for comparison
  link-dockets.ts                Links recorded legal challenges to real CourtListener dockets
  generate-court-ids.ts          Regenerates the court lookup from CourtListener's own /courts/ API
  merge-duplicate-orders.ts      Merges orders recorded twice (dry-run by default)
  record-correction.ts           Corrects one field of one row, and writes down that it happened
  snapshot-summaries.ts          Freezes the firm's curated summaries to a committed file
  data-diagnostics.ts            Post-run data-quality report (counts, duplicates, flags)
src/
  app/
    page.tsx                 Tracker dashboard (table, search, filters, paging)
    eo/[id]/page.tsx          EO detail page
    draft/page.tsx            Content-drafting assistant
    needs-attention/page.tsx  Flagged rows + recent ingestion run history
    prompt/page.tsx           Edit the summarization prompt, no deploy needed
    usage/page.tsx            What the AI has cost, by day and by feature
    api/generate-content/     Content generation API route
    api/cron/                 Federal Register ingest/enrich/reconcile jobs (CRON_SECRET-gated)
  components/                 UI components (table, filters, tags, badges, drafter, header)
  config/                     Fixed Practice Area / Industry / Subject Area lists
  data/legacy-import/         Extracted spreadsheet data (generated — see scripts/ above)
  lib/
    types.ts                  Shared TypeScript types (mirrors the SQL schema)
    supabase.ts                Supabase client factories (anon; service-role for ingestion)
    data.ts / executive-orders.ts  Data access layer — Supabase if configured, else local JSON
    executive-orders-search.ts  One page of tracker results, searched and filtered in Postgres
    ai-model.ts                Per-task model routing + the single AI-credentials access point
    normalize-title.ts         How two records are compared for being the same instrument
    taxonomy.ts                Typed accessors for the Practice Area / Industry config
    content-generation.ts      Prompt construction + Claude API call for drafting
    cron-auth.ts               Verifies a request came from Vercel Cron (CRON_SECRET)
    federal-register/          Federal Register client, sync/ingest/enrich/reconcile, the duplicate guard
    courtlistener/             CourtListener docket search + the deterministic case-matching gate
    classify/                  Practice-area and industry classification (tags only, never summaries)
    merge/                     Duplicate-pair detection and the field-by-field merge rules
    corrections/               The recorded-correction format
    diagnostics/               The data-quality report builder
    summary-prompt/            The stored, editable summarization prompt
    usage/                     Token/cost metering and the pricing table
supabase/
  migrations/0001…0008       Schema, RLS, grants, search index, and the tracker's search function
vercel.json                  Cron schedules for the three /api/cron/* jobs
```

## Fixing data by hand

Three tools, each deliberately narrow, and each leaving a committed record of what it
did. None of them is a migration: a data fix is reviewed as a dry run, not applied the
moment it is pushed.

**`npm run diagnostics`** — the report to run after any ingestion or bulk pass. Record
counts, date-sanity failures, prior-administration holdovers, duplicate EO numbers,
duplicate instruments (same title and signing date), and `needs_review` broken down by
reason. Reads only; changes nothing.

**`npm run correct`** — corrects one field of one record, appending what changed, why,
and the previous value verbatim to `data/data-corrections.json`.

```bash
npm run correct -- --eo "EO 14183" --field aiSummary --reason "..."          # dry run
npm run correct -- --eo "EO 14183" --field aiSummary --reason "..." --apply  # does it
```

Deliberately one record at a time. Clearing a field also removes it from
`manually_edited_fields`, so the normal enrichment pipeline regenerates it.

### Merging duplicate records

**`npm run merge:duplicates`** merges orders recorded twice — once from the spreadsheet,
once from the Federal Register.

```bash
npm run merge:duplicates              # dry run: prints every planned merge, changes nothing
npm run merge:duplicates -- --verbose # dry run, plus every resolved field per pair
npm run merge:duplicates -- --apply   # does it
```

The legacy row survives — it holds the firm's analysis, and other records already
reference its id — and gains the Federal Register's source text, citation, URL,
publication date and document number. Which side wins each field is a table in
`src/lib/merge/merge-rules.ts`, derived from the data rather than guessed: every legacy
row carried the identical `manually_edited_fields` list and every ingested row carried
none. Three details worth knowing before running it again:

- **The write order is forced by the schema.** `document_number` is `unique`, so it
  cannot sit on both rows at once. Each merge copies every other field first, deletes
  the ingested row, then writes the document number. The reverse order would destroy
  Federal Register data if the second step failed.
- **A column with no rule stops the run.** Anything absent from `FIELD_PREFERENCE` is
  refused rather than defaulting to one side. This is not hypothetical: `action_type`
  was missing on the first pass and would have kept four stale
  `"Pending Federal Register Publication"` placeholders without saying so.
- **The plan is written before any database write**, to `data/duplicate-merges.json`,
  on a dry run as well as a real one. That file is the recovery record.

## Next steps (in rough order)

1. **Alerting.** Every failure mode — a dead cron, a flagged hallucination, a Federal
   Register outage — surfaces only on `/needs-attention`, which someone has to remember
   to open. A production cron once failed eight nights running before anyone noticed.
   This is the highest-value unbuilt thing.
2. **Resolve the 30 ambiguous docket matches** (see "Legal challenges"), then decide
   how to approach the 91 unmatched.
3. **Legal-challenge discovery** for the orders with no recorded challenge at all —
   the big one, and not started. Design the verification gate before the retrieval.
4. **A human-graded accuracy sample.** Nothing has independently checked the AI
   summaries or the practice-area tags against a person's judgement. Sample N rows,
   pair each summary with source excerpts, grade three ways, store the results in a
   committed file (deliberately not a database table) and have `npm run diagnostics`
   report accuracy over time.
5. **News mentions** (the `NewsMention` type exists and is unused). News has no docket
   number to verify against, so it needs its own verification design.
6. **Auth** (Supabase Auth) with the admin/general role split the schema already
   supports, and the email digest — Phase 5. Tighten the four SELECT policies `0002`
   loosened at the same time.
7. **UI pages for the Rescinded Prior Orders (112) and Agency Actions (32) data** —
   imported and available via `src/lib/data.ts`, but surfaced nowhere.
8. **An end-to-end test.** Nothing automatically proves a user can go tracker → EO
   detail → draft content → export. Accepted while there is one user; revisit the
   moment there are two.
