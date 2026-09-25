# Sheppard EO Tracker

An internal tool that tracks executive **actions** from the current administration
(Jan 20, 2025 onward) — executive orders, proclamations and memoranda alike — enriches
them with AI-generated summaries and firm-specific tagging, tracks related litigation
and news, and helps attorneys draft client alerts, blog posts, talking points, and
social posts grounded in that data.

"Actions", not "orders": only 288 of the 561 rows are executive orders. The rest are
194 proclamations, 75 memoranda and a pardon — **49% of the corpus carries no EO
number at all** and is not an executive order. The UI is named **Executive Actions
Tracker** for the same reason.

This replaces a manually-maintained spreadsheet. Phases 1 and 2 are live (data model,
tracker UI, content drafting, Federal Register ingestion, AI summarization and
tagging); Phase 3 is partly built (litigation dockets yes, news no); Phases 4–5
(email digest, real accounts) are not started.

## Current status

Verified against the live database on 2026-09-24.

| Piece | Status |
|---|---|
| Supabase | ✅ Connected. Migrations `0001`–`0009` applied — see "Setting up Supabase" |
| Tracker table + order detail pages | ✅ Live — **561 orders** (288 executive orders, 194 proclamations, 75 memoranda, 1 pardon), signed from 2025-01-17 |
| Search, multi-select filters, signing-date range | ✅ Live, executed in Postgres (`search_executive_orders`, migrations `0007`/`0008`) |
| Relevance ranking | ✅ Live — a search now ranks by relevance automatically; see "How search is ordered" |
| Order status (active / amended / revoked) | ✅ Live and **corrected 2026-09-22** — the disposition parser had the polarity inverted; 42 rows were wrong. See "How an order's status is decided". Now 548 active, 9 amended, 2 revoked |
| Subject-area filter | ✅ Live — a dropdown with find-as-you-type over all 26 subjects (`p_subjects`, migration `0009`) |
| Search snippets | ✅ Live — the matching passage of the order's text appears under the title with the matched words marked (`ts_headline`, migration `0009`) |
| Clickable tags | ✅ Live — a subject or practice tag filters to itself; "Undo tag filter" restores what was there |
| Firm branding in the UI | ⚠️ Deliberately absent — see "Branding and the placeholder palette" |
| Federal Register ingestion | ✅ Live — three Vercel Cron jobs, see "Federal Register ingestion" |
| Summaries | ✅ **All 561 rows** have one; the enrichment queue is empty. **275** are the firm's hand-written text, protected from automated overwrite via `manually_edited_fields`; the rest are AI-written |
| AI practice-area / industry tagging | ✅ **434** rows carry a practice area and **316** an industry; subject area is on all 561. The untagged remainder is overwhelmingly ceremonial — see "What is actually filled in, per order" |
| Quote verification | ✅ A summary or draft quoting text not found verbatim in the source is never saved |
| Content-drafting UI (4 content types, single & multi-EO) | ✅ Live, producing real AI output. Its order picker has its own search and filters. Every draft opens with a title, its content type, and the orders it covers — see "What a generated draft looks like" |
| Copy / .docx / markdown export | ✅ Gated behind a "reviewed for accuracy" confirmation, client-side |
| Shared drafts | ✅ Live — every generated draft is saved and visible to everyone at `/drafts`, and is surfaced on the order it covers and in the drafter before you generate a duplicate. See "Shared drafts" |
| Shared-password gate on the admin pages | ⚠️ Built, **dormant** — covers `/needs-attention`, `/prompt`, `/usage` and `/api/summary-prompt` only; the tracker and drafter stay open. Set `SITE_PASSWORD` plus a redeploy to turn it on; see "Interim access" |
| Litigation docket linking (CourtListener) | ⚠️ Partly — **131 of 252** recorded challenges linked; 30 need a human decision, 91 unmatched |
| Legal-challenge *discovery* (orders with no recorded challenge) | ❌ Not started — everything so far only links cases the firm already found |
| News mentions | ❌ Not started — the `NewsMention` type exists and is unused |
| Alerting when a scheduled job fails | ✅ Live — a fourth cron posts to Slack when a job fails, goes missing, sticks, or stalls; see "Alerting" |
| Email digest | ❌ Not started (Phase 5) |
| Auth / admin vs. general user roles | ❌ Not started (Phase 5) — RLS policies for it already exist in the schema |

## How search is ordered

A search ranks by relevance; browsing without one lists newest first. The
ranking itself has existed since migration `0007` — title and EO number
weighted 'A', summary and tags 'B', body text 'D' — but nothing reached it
until 2026-09-21, because the sort defaulted to date whatever had been
typed. Searching "tariff OR duty" returned its 164 matches led by
Constitution Day and Patriot Day.

The default is a function of the query rather than a constant
(`defaultSortFor` in `src/lib/tracker-query.ts`), and parsing and
serializing both go through it. That is what lets a reader switch back to
"Newest first" on a search and keep it: the query string omits `sort` only
when it matches the default *for that state*, so on a search an explicit
`date` is written to the URL rather than dropped and re-defaulted back to
relevance on the next read. Changing the search text re-decides the sort;
changing a filter or turning a page does not.

## What is actually filled in, per order

Measured live 2026-09-24 across 561 orders. The AI enrichment pass writes
**four** fields and nothing else; everything below the second heading comes
from the firm's spreadsheet or the docket-linking script.

| Written by the AI pass | Filled | Firm-authored | AI-written |
|---|---|---|---|
| `ai_summary` | 100% | 275 | 286 |
| `subject_area` | 100% | 338 | 223 |
| `practice_areas` | 77% | 0 | 434 |
| `industries` | 56% | 0 | 316 |

Among the 286 orders the AI summarized itself, it returned a subject area
every time, practice areas on 57%, and industries on 47%. **The blanks are
mostly correct, not failures**: of the 127 orders with no practice area, 124
are "Establishing Dates of Importance" and 126 of 127 are proclamations —
the classifier is declining to tag ceremonial documents. Of the 245 with no
industry, 115 are ceremonial and most of the rest are government, justice or
immigration matters where no client industry applies. A minority are
arguably under-tagged; there is no ground truth to measure that against.

| Never written by the AI | Filled |
|---|---|
| `deliverable` | 99% |
| `timeline_notes` | 60% |
| `agencies_impacted` | 57% |
| `available_analysis` | 9% |
| `legal_challenges` | 7% |
| `key_dates` | **0%** |
| `news_mentions` | **0%** |

`key_dates` and `news_mentions` have columns, types and UI, and nothing
writes them. The detail page **omits a section whose field is empty** rather
than printing a heading over "None recorded.", which said nothing about the
order and read as the tool having failed. Two sections are deliberately
exempt: Legal Challenges still reports "No known legal challenges", because
absence is an answer a partner wants and hiding it would make it
indistinguishable from nobody having checked; and Summary keeps its "not
generated yet" fallback, which means enrichment has not reached that row.

## Shared drafts

Every generated draft is saved and visible to everyone. The point is not
archiving — it is that the next person finds what already exists instead of
paying to generate it again.

**Where it lives**: the `content_drafts` table, in the same database as the
orders. `eo_ids`, `content_type`, `title`, `draft_text`, `created_at`, plus
`created_by` and `reviewed_at`, which are always null today and are
explained below. Nothing is kept in the browser but a draft's id and its
delete token.

**How anyone finds one**, in descending order of how much good it does:

| Where | What it says |
|---|---|
| In the drafter, before generating | "1 Client Alert / Memo has already been written about this order" — red, because it is probably a duplicate and costs money |
| | "1 other draft already covers this order" — milder, for a different content type: context, not a reason to stop |
| On an order's page | "1 draft has already been written about this order", above the summary |
| `/drafts` | All of them, newest first, each naming and linking the orders it covers |

The drafter loads existing drafts once with the page and matches them in the
browser as the selection changes, so ticking an order costs no round trip.
A multi-order digest is found by any single order it covers.

**No migration was needed, and that is deliberate.** `content_drafts` has
existed since `0001`, and its RLS was written for accounts that do not exist
yet — insert wants `created_by = auth.uid()`, select wants an authenticated
role, and no anonymous caller satisfies either. Rather than loosen those
policies, every access goes through the service-role client on the server.
The policies stay correct for the day auth ships, and the table stays shut to
the browser.

### Who may delete a draft, without accounts to say who anyone is

On generation the server returns the new draft's id and an HMAC of that id,
and the browser keeps both in sessionStorage. Deleting presents the token;
the server recomputes and compares. Deriving the token instead of storing a
column keeps it off the schema and out of every listing.

That scoping is load-bearing, because `/drafts` publishes every draft id. A
token good for one draft is the difference between "delete mine" and "delete
anything" — a valid token for a *different* draft is refused.

Admin delete is gated on `hasActiveAdminSession()`, **not**
`hasAdminAccess()`. The latter returns true when `SITE_PASSWORD` is unset so
local development works; reused here it would have meant "everyone is an
admin" on a deployment with the gate off, which is this one today.

**Two consequences, both accepted rather than overlooked:**

- **Close the tab and the token is gone.** With no accounts, "yours" is the
  session that made the draft. After that, only an admin can remove it — and
  admin delete does nothing until `SITE_PASSWORD` is set. Until then an
  abandoned draft is effectively permanent.
- **Nothing here has been checked by a person.** Every row says so, on the
  row rather than once at the top, because someone reusing a draft may never
  have seen the heading.

## How an order's status is decided

Federal Register disposition notes come in two voices, and only one of them
says anything about the document carrying it:

```
Revokes: EO 14036          EO 14337 revoked 14036. ACTIVE voice -- it says
                           nothing about 14337, which is in force.
Revoked by: EO 14244       EO 14237 was revoked.   PASSIVE voice -- this is
                           the one that changes a status.
```

`parseDispositionNotes` read `^Revokes:` as "this order is revoked" until
2026-09-22, so all 24 orders that had revoked something were displayed as
revoked -- "Protecting the American People Against Invasion" and
"Unleashing American Energy" among them -- while "Addressing Risks From
Paul Weiss", whose notes read "Revoked by: EO 14244", stayed active because
no pattern matched it. The tracker was wrong in both directions at once. 42
rows were corrected; live counts went from 24 revoked / 22 amended to 2 / 9.

**Only passive forms change a status.** The recognized vocabulary is taken
from the corpus rather than guessed -- count the line prefixes before adding
one. "Continued by" is deliberately not a downgrade: being continued means
still in force.

**A status can change long after publication**, which is why it is re-read
at all. An order is ingested as active and revoked months later, and the
revocation appears on the original's own notes. Two things make that land:
`syncDocument` re-reads the disposition instead of returning "unchanged" the
moment a document_number matches, and the weekly reconcile job re-checks
every stored row, because the daily job's trailing window is long past an
order revoked in September. Neither downloads any text to do it -- see the
rate-limit note in fetch-with-retry.ts.

## Filtering, and one rule about filter values

Every filter lives in the URL, so a filtered view can be shared, bookmarked
and reached with the back button. Subjects, practice areas and industries
are multi-select: values OR within a field and AND across fields, which is
how a reader expects checkboxes to behave.

**One parameter per value. Commas are not separators.** `?industry=A&industry=B`,
never `?industry=A,B`. Until 2026-09-22 the parser split on commas as a
convenience for hand-written URLs, and it silently broke the three real
industries whose names contain one: ticking "Aerospace, Defense & Government
Services" parsed back as two values that match nothing, so the tracker
showed **0 orders** and two invented filter chips with nothing to explain
it. "AI, Robotics and Quantum" and "Retail, Fashion & Beauty" failed the
same way. Nothing the app generates is comma-joined, so the convenience only
ever damaged values produced by clicking. If you add a taxonomy value
containing a comma, it now works; if you re-introduce comma splitting, it
will not.

Clicking a tag on a result row **replaces** the current filters rather than
adding to them, so a click can never land on an empty page by stacking onto
filters that share no rows. Because that is destructive, the link carries
the previous query string and the results bar offers "Undo tag filter". The
undo value is rebuilt through the tracker's own parser rather than pasted
into a link, so an edited `?undo=https://elsewhere` cannot send a reader off
the site.

**Known cost**: selecting "All" *and* searching makes Postgres build a
snippet for every matching row rather than for one page — measured 1.67s
against 0.65s for a page of 25, on 561 rows. It works; it is simply the one
combination the migration's paging trick does not cover. Fixing it properly
needs another migration.

## What a generated draft looks like

Every draft opens with a header before the model's words:

```
# Federal Procurement Reciprocity Memorandum Targets Canadian-Origin Items (Client Alert / Memo)

**Executive order covered:**

- [Trade — Restoring Reciprocity in Government Procurement](https://www.federalregister.gov/documents/...)

---
```

**The title is the model's; everything else is the database's**, and the
split is deliberate. Naming a piece is a judgement about its content, so the
model does that. The order labels and, above all, the URLs are fact, so they
are built in `src/lib/content-header.ts` from stored values. A model asked
for links will eventually write a plausible one that does not resolve, and
this is a document a firm may send to a client, so `buildSystemPrompt` tells
it not to write URLs at all and nothing it returns reaches the link. An
order with no Federal Register record reads "no source link on file" rather
than getting a guessed URL.

An order with no EO number is labelled by its subject area — proclamations
and memoranda never carry a number, which is why the example above reads
"Trade".

The model is asked for a bare title on the first line. If it opens with
prose instead, `splitTitleFromDraft` declines to use a first line over 140
characters and the draft falls back to the order's own title, so a
disobedient model loses its header rather than its opening paragraph. Stub
drafts (no AI credentials) are assembled the same way, so what a developer
sees locally is shaped like what attorneys get.

## Accessibility notes

Not audited end to end, but these were measured and fixed on 2026-09-22, and
are worth not regressing:

- `--border` is for decorative hairlines; `--control-border` is for the edge
  of an input, select or dropdown, and clears WCAG 1.4.11's 3:1 against both
  the white fill (3.41:1) and the cream page (3.10:1). The old single border
  was 1.30:1 and read as no border at all.
- Controls carry a real focus ring. Do not replace one with `outline-none`
  plus a border-colour swap; that removes the focus indicator in forced-
  colours mode too.
- Touch sizing keys off `pointer: coarse`, not a width breakpoint — a tablet
  in portrait is a touch device at 660px wide.
- `aria-label` on an element **overrides** its visible text. The filter
  dropdown once carried `aria-label={label}`, so a screen reader announced
  "Subjects" and never "3 selected".

## Branding and the placeholder palette

**The firm's name appears nowhere in the UI, on purpose.** The tool is not
yet approved for use under it, so the product names itself: the header
wordmark, the browser tab title and the dormant password gate all read
"Executive **Actions** Tracker" — actions, not orders, because the corpus
includes proclamations and memoranda, and because it is the firm's own word:
their source spreadsheet is the Executive Actions Tracker.

The repo, this file and the code comments still use the firm's name; only
the rendered UI is anonymous. Two outbound
`USER_AGENT` strings (`src/lib/courtlistener/client.ts`,
`src/lib/federal-register/fetch-with-retry.ts`) also still identify the firm
to those two APIs — deliberate API etiquette, but worth knowing.

The colours in `src/app/globals.css` are a placeholder sampled from a public
law-firm site, not real brand assets: cream ground, ink-navy chrome and
type, periwinkle for links and focus, warm gold for decorative tags. Swap
those values and the wordmark once real assets (hex codes, logo file, font
names) arrive.

The tracker's own layout is tuned for one thing: how many orders fit on a
screen. Filters sit in a column at the left rather than a band above the
results, the container runs to 1920px rather than 1280, and the page heading
is `sr-only` because the banner already names the product. Together those
took the space above the first row from 375px to 232px. The 1920px cap is
deliberate rather than "no limit" — on a wider monitor an uncapped summary
line runs past what anyone reads comfortably.

`shadcn/ui` was added 2026-09-21 (base-nova style, Base UI primitives).
Its token names are the vocabulary the whole app now uses, so `muted` is a
surface and `muted-foreground` is the grey text on it, `primary` is the
colour of a primary action, and `accent` is reserved for shadcn's own hover
states. This app's own decorative colour is `brand`, deliberately not
`accent`, because shadcn components style their hovers with `bg-accent`.

## Getting started

```bash
npm install
npm run dev
```

Open http://localhost:3000.

With no `.env.local`, the app falls back to the imported spreadsheet data in
`src/data/legacy-import/*.json` — real firm data, but a frozen January 2026
snapshot of 340 rows, and a visible banner says so. To work against the live
561-row database, set at least `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (see "Environment variables").

## Where the data comes from

Three sources feed the tracker:

| Source | What it provides | How it arrives |
|---|---|---|
| The firm's spreadsheet | The 340 hand-curated rows, including every summary and analysis an attorney wrote | One-time import, already done |
| [federalregister.gov](https://www.federalregister.gov/developers/documentation/api/v1) | Every new executive action, plus source text, citation and official URL | Daily cron — free, no API key |
| [CourtListener](https://www.courtlistener.com) | Real docket numbers, filing dates and URLs for recorded litigation | `npm run link:dockets`, by hand — free |

Of the 561 rows today, **507 carry Federal Register source text** and 54 are
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
- **`key_dates` and `news_mentions` are empty on all 561 rows.** The columns and types
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
# access before real auth" below). Leave unset for local development; it is
# deliberately unset in production too, as of 2026-09-16.
SITE_PASSWORD=

# Required in production once the /api/cron/* jobs are scheduled (see
# "Federal Register ingestion" below) — generate with `openssl rand -hex 32`.
CRON_SECRET=

# Slack incoming webhook the watchdog posts to when a scheduled job fails,
# goes missing, sticks, or stalls (see "Alerting"). Treat it as a secret:
# anyone holding it can post into that channel. Without it the watchdog
# refuses to run at all rather than checking and having nowhere to report.
SLACK_ALERT_WEBHOOK_URL=

# Signs the short-lived tokens that gate /api/generate-content and
# /api/summary-prompt — the two routes that spend money and write. Generate
# with `openssl rand -hex 32`. Without it those two endpoints refuse every
# request and the Generate / Save buttons render disabled with an
# explanation; everything else works. See "Protecting the write endpoints".
REQUEST_TOKEN_SECRET=

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

There's no user accounts system yet (that's Phase 5). `SITE_PASSWORD` in the
deployment's environment variables gates **the admin pages only**, via
`src/proxy.ts`, which redirects anyone without the right cookie to `/gate`, a
single shared-password prompt:

| Gated | Open |
|---|---|
| `/needs-attention`, `/prompt`, `/usage` | `/` and every `/eo/[id]` |
| `/api/summary-prompt` | `/draft` |

That split is the point. The tracker is meant to be shared; the pages that
expose flagged rows, AI spend and the prompt the nightly job runs on are not.
`/api/summary-prompt` is gated with `/prompt` because protecting the page and
leaving open the endpoint that writes the prompt would protect nothing.

**It is not set today**, so nothing is gated and every page behaves as it did
before. Setting the variable and redeploying enables it in about thirty
seconds, which is why none of the machinery has been deleted. Remove
`src/proxy.ts`, `src/app/gate/`, `src/app/api/gate/`, `src/lib/site-auth.ts`
and `src/lib/site-access.ts` once Supabase Auth ships.

The header hides the admin links when the cookie is absent
(`src/lib/site-access.ts`), so the nav does not advertise a locked door. That
is cosmetic: the proxy is what actually protects the routes, and if the two
ever disagree the proxy wins.

**A shared password is not access control.** No per-user identity, no roles;
it cannot tell you apart from anyone you gave the password to. It keeps a
deployed URL from being fully open, and that is all.

Three things worth knowing:

- **It needs no paid Vercel plan.** Vercel's own Deployment Protection is a paid add-on;
  this is the app's own gate, and `SITE_PASSWORD` is an ordinary environment variable
  that works on Hobby.
- **The matcher lists what IS gated**, rather than "everything except", which
  is what it used to be. A new page is therefore public unless it is added to
  the list; the old form gated every new route by accident. Next parses the
  matcher at build time and rejects a computed value, so the patterns are
  written out literally in `src/proxy.ts` and `admin-routes.test.ts` asserts
  they match `src/lib/admin-routes.ts`.
- **`/api/cron/*` is not gated, deliberately.** Vercel Cron sends a plain GET
  expecting JSON, not a redirect to an HTML login page — a 307 would have the
  nightly jobs "succeed" while doing nothing. Those routes answer to
  `CRON_SECRET` instead. Verified when the matcher last changed: with
  `SITE_PASSWORD` set, `/` and `/draft` return 200, the admin pages redirect
  to `/gate`, and `/api/cron/watchdog` returns 401. Re-check all three if you
  touch the matcher.

### Protecting the write endpoints

`SITE_PASSWORD` was removed on 2026-09-16 so the tracker could be shared
freely. That left two routes reachable by anyone with the URL:
`/api/generate-content`, which calls Claude Opus 5 and costs money, and
`/api/summary-prompt`, which rewrites the instructions every future nightly
summary is generated from. Both are now behind two independent checks.

**A short-lived signed token** (`src/lib/request-token.ts`). Each render of
`/draft` and `/prompt` mints an HMAC token valid for 12 hours; the client
component sends it back as an `x-eo-request-token` header, and the route
verifies it before doing anything.

**Be clear about what that is worth.** Those pages are client components
fetching from the browser, so the token is delivered to the browser and
anyone who opens devtools can read it. It stops scrapers, crawlers and
drive-by scripts hitting the endpoints directly. It does **not** stop a
determined person, and it is not authentication — `SITE_PASSWORD` or Phase 5
accounts are what actually close these routes.

There is deliberately **no token-refresh endpoint**: anything that minted
tokens without authentication would let anyone mint one, defeating the
mechanism entirely. An expired token means reload the page. Expiry therefore
buys little against a person, who could just reload it too; its real value is
putting a clock on a token that leaks into a screenshot or a shared log.

**An hourly ceiling on spend** (`src/lib/generation-limit.ts`). At most
`CONTENT_GENERATIONS_PER_HOUR` (20) content generations per hour across the
whole deployment, counted from the `api_usage` rows already being written —
no new table, and no visitor identifiers stored. The token decides *who* may
call; this decides *how much calling can cost*, which is the part that
actually bounds the bill if a token is extracted. Deliberately global rather
than per-caller, because a spend ceiling is a property of the deployment; the
cost is that one runaway caller blocks everyone until the window rolls over.

It is not a substitute for the monthly cap on the Anthropic account — that is
still the real backstop. This just stops a loop exhausting it in an hour. If
the counting query itself fails the request is allowed through and a loud
`console.error` says the ceiling is not being enforced, since a Supabase blip
should not take drafting down for a one-person tool.

## Federal Register ingestion

Three independent jobs keep `executive_orders` in
sync with [federalregister.gov's API](https://www.federalregister.gov/developers/documentation/api/v1)
(no key required — see `src/lib/federal-register/`):

- **`ingest`** (daily, `/api/cron/ingest`) — re-checks the trailing 90-day
  publication window for new documents and corrections. "New" is
  existence-based (an unseen `document_number`), not date-based — the window
  just keeps each run's query cheap. A document already stored costs one
  database lookup and **no network request**: its full text is fetched only
  when the job is actually going to store it. Until 2026-09-19 all ~47
  documents in the window were downloaded in full every night and then
  discarded, which is how a run came to die on 47 consecutive 429s.
- **`enrich`** (daily, `/api/cron/enrich`) — fully decoupled from ingestion.
  Summarizes and tags ~20 orders per run (conservative, to control Anthropic
  cost), verifying any quoted text against the order's stored `full_text` in
  code before saving — a summary with an unverifiable quote is never saved;
  the row is flagged for review instead.
- **`reconcile`** (weekly, `/api/cron/reconcile`, Mondays 11:00 UTC) — does
  two things over the *full* administration-to-date range rather than the
  daily job's trailing window. **Gaps**: a cheap `document_number` diff
  against the API, so a gap older than that window doesn't silently persist.
  **Statuses**: every stored order's disposition re-read from the same
  response, which is the only way a revocation is ever noticed — disposition
  notes are written onto a document after publication, so an order ingested
  in February and revoked in September learns of it only from a later look at
  its own notes, by which time the daily window is long past. Costs no extra
  request, just two more fields on a page already being fetched. Reports
  `statusChangedCount` alongside `gapsFound`. Logged as its own run type so a
  completeness gap is never confused with an ingestion failure.

All three are Vercel Cron jobs (see `vercel.json`), authenticated via
`CRON_SECRET` (see `.env.example`) — never open endpoints.

**Rate limiting**: every Federal Register request goes through
`src/lib/federal-register/fetch-with-retry.ts`, which identifies the client,
gives the request a deadline of its own, and retries a 429 or a transient
5xx three times from a 2-second backoff. Deliberately less patient than the
CourtListener client — these run inside cron functions with a hard execution
cap, and ingest is idempotent, so a throttle that outlasts a few seconds is
reported (the watchdog posts it to Slack) rather than waited out. Each retry
is logged, so a tightening limit shows up before it breaks a run.

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
and recent run history. It used to be the only place any of this was visible;
the watchdog below now comes to you instead. Each of its two sections loads
independently, so one broken query can't take the page down — which matters
because a database problem is exactly what sends you here.

**A note on source reliability**: FederalRegister.gov states its own text is
["not an official legal edition"](https://www.federalregister.gov/reader-aids/government-policy-and-ofr-procedures/about-this-site#legal-status) —
the official version is a govinfo.gov PDF. Fine for summarization and
drafting; anywhere content is asserted as authoritative, cite that PDF.

**`federal_register_url` is not that PDF**, despite what this file claimed
until 2026-09-22. `sync.ts` sets it from the API's `html_url`, so it holds
the ordinary FederalRegister.gov document page (verified live: every one of
the 505 values is a `federalregister.gov/documents/...` URL). The API's
`pdf_url`, which is the govinfo-hosted official edition, is neither
requested nor stored, and it cannot be derived from what is stored because
no publication date is kept. **Linking "the official PDF" from the app
therefore needs a schema change first** — request `pdf_url` in the Federal
Register client, add a column, backfill. Until then, link the document page
and call it what it is.

## Alerting

Three cron jobs keep the data fresh; a fourth watches *them*. `/api/cron/watchdog`
runs daily at 12:00 UTC (after all three) and posts to Slack when something is
wrong — see `src/lib/alerts/`.

**Why a separate job rather than checks inside the three.** All three
orchestrators call `startRun()` *before* their `try` block. A job that dies
earlier than that — Supabase unreachable, the overlap guard refusing, a denied
write — leaves no `ingestion_runs` row at all, and a cron that never fires
leaves no trace anywhere. Nothing inside a job can report that the job didn't
run. Absence is only visible from outside.

It reads `ingestion_runs` and the enrichment queue and **writes nothing** — not
even a row saying it ran. A logged run would have to pass through `startRun()`'s
overlap guard, so the one job meant to notice other jobs jamming could itself
jam. Its record is the message it sends.

What it reports, at most one problem per job type so a single cause can never
produce two messages:

| Check | Fires when |
|---|---|
| Never run | No run of that type has ever been recorded |
| Missing | Newest run older than its allowance — 20h for the daily jobs, a week plus two hours for weekly reconcile |
| Stuck | Newest run still at `running` past `STALE_RUN_THRESHOLD_MINUTES`, which is what a platform timeout after `startRun` leaves behind |
| Failed | Newest run recorded `failure` or `partial` |
| Enrichment stalled | Rows queued while the last **two** enrichment runs summarized none |
| Unreadable | It couldn't read the database — reported *to Slack*, since a watchdog that can only speak when its database answers is silent exactly when the database is the problem |

**Quiet when healthy, plus one all-clear every Monday.** Silence alone is
ambiguous — it could mean "nothing is wrong" or "the watchdog is dead" — so the
Monday note is what makes the other six days' silence mean something. A Monday
that arrives without it is itself the alarm.

**Two thresholds worth understanding before changing them.** The daily allowance
is 20h, not 25h, because lateness works *against* detection: if yesterday's run
started an hour late and today's never fires at all, the observed gap is 25h,
not 26h, so a tight allowance misses the case it exists for. The weekly
allowance takes the opposite trade (a week plus two hours) because a false alarm
is worse than a day's delay there. The values live in
`src/lib/alerts/thresholds.ts` and are derived from `vercel.json`'s schedules —
change a schedule without changing them and you get either a recurring false
alarm or a blind check.

**Enrichment stalling needs two consecutive runs, not one.** Ingest and enrich
are half an hour apart but Vercel does not guarantee their order within the
hour, so enrich can legitimately run against an empty queue moments before
ingest inserts a document. Alerting on one such run would cry wolf on a healthy
pipeline, and the next night picks the row up normally.

**Proving the channel.** A quiet watchdog can never tell you it still works, and
`SLACK_ALERT_WEBHOOK_URL` is a Vercel Secret whose value cannot be read back —
so "the variable is listed" is not evidence it holds a working URL. Force a send
any time:

```bash
curl -s -H "Authorization: Bearer $env:CRON_SECRET" "https://ex-ord-insights.vercel.app/api/cron/watchdog?verify=1"
```

(PowerShell syntax, since that is the shell this project is developed in — use
`$CRON_SECRET` in bash. A healthy forced send answers
`{"problemCount":0,"sent":true,"forced":true,"verify":true}`.)

That sends even when everything is healthy, worded as a channel test rather than
an all-clear — a test that read like the Monday note would be worse than sending
nothing.

**What it still cannot do.** It is a cron itself, so it cannot report its own
death; the Monday all-clear is the only signal for that. And `flagged_count` /
`skipped_count` are computed by the jobs but never persisted to
`ingestion_runs`, so the watchdog is blind to both — flagged rows it reads from
`executive_orders.needs_review` instead, and skipped corrections it cannot see
at all.

## Firm-specific tagging lists

The three fixed lists the AI must choose from live in:

- `src/config/practice-areas.json` — each entry carries a one-line `criteria` string
  telling the model when that group should be selected. `Governmental` additionally
  carries `subPractices`, the firm's subgroups, each with its own criteria
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
  one of its own subgroups is dropped. The pilot proved the model returns both forms
  even when explicitly asked not to.
- **No practice may be listed both standalone and as a subgroup.** Antitrust and
  White Collar once were, which split each practice's rows across two filter options
  (White Collar: 74 and 14). Migration `0010` merged the subgroups into the
  standalones — the only form the nightly summarizer can write, since it accepts
  top-level names only — and `taxonomy.test.ts` fails if a duplicate is re-added.

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
    page.tsx                 Tracker dashboard (results list, search, filters, paging)
    drafts/page.tsx          Every draft the team has generated
    api/content-drafts/      Deleting a shared draft (token or admin)
    eo/[id]/page.tsx          EO detail page
    draft/page.tsx            Content-drafting assistant
    needs-attention/page.tsx  Flagged rows + recent ingestion run history
    prompt/page.tsx           Edit the summarization prompt, no deploy needed
    usage/page.tsx            What the AI has cost, by day and by feature
    api/generate-content/     Content generation API route
    api/cron/                 Federal Register ingest/enrich/reconcile + the watchdog (CRON_SECRET-gated)
    error.tsx                 Shown when a page throws — in practice a failed Supabase read
  components/                 UI components (result rows, filters, tags, badges, drafter, header)
    eo-results.tsx / eo-result-row.tsx  One row per order: title, summary, tags, status
    tracker-controls.tsx        Debounced search state + navigation (the only client component
                                on the tracker; the rows render on the server)
    tracker-filter-bar.tsx      Search box and filter dropdowns
    tracker-result-bar.tsx      Match count, active-filter chips, sort, page size
    eo-selection-bar.tsx        The sticky bar that hands ticked orders to the drafter
    tracker-search-field.tsx    The full-text box at the top of the results column
    draft-order-picker.tsx      The drafter's order list, with its own search and filters
    existing-drafts-warning.tsx Says a draft already exists, before you make another
    drafts-about-order.tsx      The same, on an order's own page
    draft-list-item.tsx         One shared draft, with delete for those allowed it
    saved-draft-notice.tsx      "Saved for the team", and the author's delete
    ui/                         shadcn/ui components (added 2026-09-21)
  config/                     Fixed Practice Area / Industry / Subject Area lists
  data/legacy-import/         Extracted spreadsheet data (generated — see scripts/ above)
  lib/
    types.ts                  Shared TypeScript types (mirrors the SQL schema)
    supabase.ts                Supabase client factories (anon; service-role for ingestion)
    data.ts / executive-orders.ts  Data access layer — Supabase if configured, else local JSON
    executive-orders-search.ts  One page of tracker results, searched and filtered in Postgres
    tracker-query.ts           The tracker's URL state: search, filters, sort, paging
    tracker-filter-chips.ts    Which filters are active, and how to remove one
    tag-filter-link.ts         Where a clickable tag goes, and how to undo it
    content-drafts.ts          Reading and writing the drafts the team shares
    draft-delete-token.ts      Proof a browser created a given draft
    drafts-for-selection.ts    Which existing drafts cover what is selected
    session-drafts.ts          The drafts this session made, and their tokens
    order-labels.ts            Naming an order referred to from elsewhere
    admin-routes.ts            Which pages the shared-password gate covers
    site-access.ts             Whether this request may see them (header only; the proxy enforces)
    content-header.ts          The title/type/source-links block every draft opens with
    filter-picker-orders.ts    In-browser filtering for the drafter's order list
    highlight-snippet.ts       Turns the database's [[hl]] markers into plain segments
    tag-label.ts               How a stored tag is spelled on screen
    eo-selection.ts / eo-selection-store.ts  Which orders are ticked, held in sessionStorage
    ai-model.ts                Per-task model routing + the single AI-credentials access point
    normalize-title.ts         How two records are compared for being the same instrument
    taxonomy.ts                Typed accessors for the Practice Area / Industry config
    content-generation.ts      Prompt construction + Claude API call for drafting
    cron-auth.ts               Verifies a request came from Vercel Cron (CRON_SECRET)
    alerts/                    The watchdog: health checks, Slack delivery, thresholds
    federal-register/          Federal Register client, sync/ingest/enrich/reconcile, the duplicate guard
      parse-disposition.ts     Which disposition notes change an order's own status (voice matters)
      refresh-status.ts        Re-reads a stored order's status without re-downloading it
    courtlistener/             CourtListener docket search + the deterministic case-matching gate
    classify/                  Practice-area and industry classification (tags only, never summaries)
    merge/                     Duplicate-pair detection and the field-by-field merge rules
    corrections/               The recorded-correction format
    diagnostics/               The data-quality report builder
    summary-prompt/            The stored, editable summarization prompt
    usage/                     Token/cost metering and the pricing table
supabase/
  migrations/0001…0009       Schema, RLS, grants, search index, and the tracker's search function
vercel.json                  Cron schedules for the four /api/cron/* jobs
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

1. **Make a review flag clearable.** Nothing in the app can set `needs_review` back to
   false — it isn't in `CORRECTABLE_FIELDS`, `/needs-attention` is read-only, and only
   `reconcile-legacy.ts` ever writes `false`. That blocks a real fix: a quote-flagged row
   keeps `ai_summary` null, so it is re-summarized and re-billed every night forever
   (~$0.08 a row a night). Smallest version is adding `needsReview` to
   `CORRECTABLE_FIELDS`; then `applyEnrichQueueFilter` can safely exclude flagged rows.
2. **Resolve the 30 ambiguous docket matches** (see "Legal challenges"), then decide
   how to approach the 91 unmatched.
3. **Legal-challenge discovery** for the orders with no recorded challenge at all —
   the big one, and not started. Design the verification gate before the retrieval.
4. **A human-graded accuracy sample.** Nothing has independently checked the AI
   summaries or the practice-area tags against a person's judgement. Sample N rows,
   pair each summary with source excerpts, grade three ways, store the results in a
   committed file (deliberately not a database table) and have `npm run diagnostics`
   report accuracy over time.
5. **Move the draft review gate server-side.** Export is gated on "I have
   reviewed this for accuracy" in the browser. Now that drafts are saved
   automatically and shared, an unreviewed draft is visible to colleagues who
   may reuse it, and nothing stops a stored row claiming a review that never
   happened. `content_drafts.reviewed_at` and `reviewed_by` exist and are
   always null. `0001`'s own comment anticipates this: *"once drafts are
   persisted, enforce it here too."*

6. **News mentions** (the `NewsMention` type exists and is unused). News has no docket
   number to verify against, so it needs its own verification design.
7. **Auth** (Supabase Auth) with the admin/general role split the schema already
   supports, and the email digest — Phase 5. Tighten the four SELECT policies `0002`
   loosened at the same time.
8. **Cap snippet building when "All" is selected.** With no page limit,
   `search_executive_orders` builds a `ts_headline` for every matching row rather
   than for one page — 1.67s against 0.65s today, and it grows with the corpus.
   Needs a migration: clamp the rows the snippet CTE sees, independently of paging.
9. **UI pages for the Rescinded Prior Orders (112) and Agency Actions (32) data** —
   imported and available via `src/lib/data.ts`, but surfaced nowhere.
10. **An end-to-end test.** Nothing automatically proves a user can go tracker → EO
   detail → draft content → export. Accepted while there is one user; revisit the
   moment there are two.
