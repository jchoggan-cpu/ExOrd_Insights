# HANDOFF — Sheppard EO Tracker, UI/UX upgrade (written 2026-09-21)

Repo: `C:\Users\jchog\residency\ExOrd_Insights`
Branch: `claude/eo-tracker-planning-z0unry` (also the main branch)
Live: https://ex-ord-insights.vercel.app (public, no password — deliberate)
Mockup: `C:\Users\jchog\OneDrive\2026 LQ Residency\EO-Tracker-results-mockup.pdf`

**Deadline context: there is a demonstration later this week.** Sequence the
work so the demo is safe at every point — see "Suggested order" at the end.

## FIRST TASK

Read `CLAUDE.md` and `README.md`. Both are accurate as of 2026-09-21, but
verify anything you're about to act on, including them. Then read "What the
mentor found" below — every claim in it has been reproduced against live
data, and the reproductions are recorded so you don't have to repeat them.

This session is **frontend work on a backend that is currently healthy.**
Nothing in the data pipeline needs attention. Don't go looking for it.

## HOW I WANT TO WORK

- I'm newer to coding: explain in plain language and flag jargon.
- Plan → surface open questions → get my explicit approval → then build.
- Use a Q&A format when there's a real choice. Don't guess at things only I
  can answer (firm practice, what our attorneys need, what the demo must show).
- Explicit confirmation before anything that touches live data or deploys.
- **A push to this branch auto-deploys to Vercel AND auto-applies anything in
  `supabase/migrations/`.** Migrations are always my call — show me the SQL
  before pushing, never after.
- Verify claims against live state, not notes, logs, or your own earlier
  statements. Say plainly when you were wrong.
- **MY SHELL IS POWERSHELL on Windows.** grep/cut/tr/pipe-to-stdin will fail.
  Give me **ABSOLUTE paths** in any command I have to run. I have sibling
  repos under `~/residency` and my terminal cwd is often a different one — a
  bare `notepad .env.local` once saved a secret into the wrong project.
- `CLAUDE.md` governs this repo. It is at its 250-line ceiling — trim before
  adding.
- **Run the `code-review` skill (or an adversarial subagent pass) before
  calling anything done.** It caught 3 real bugs in one change last session
  and 8 in another.

## STATE OF THE APP — verified live 2026-09-21

- **557 orders**, all with an AI summary. Enrichment queue: **0**.
- **The data pipeline is fully healthy and has now proven itself end to end.**
  Last session fixed a 429 failure in the Federal Register client. Since then:
  | Run | Result |
  |---|---|
  | 09-20 10:27 ingest | success, 7.5s, 0 new |
  | 09-21 10:27 ingest | success, **10.2s, 4 new orders** |
  | 09-21 11:21 enrich | success, 32.5s, **4 rows summarized + tagged** |
  | 09-21 11:36 reconcile | success |
  The 09-21 ingest is the important one: 4 new orders means it actually
  downloaded raw text through the new retry client in production. That was
  the one path still unproven on Saturday. It is proven now.
- Watchdog: `problemCount: 0`. Slack is quiet and correct.
- **Monday all-clear: today IS Monday 2026-09-21.** The watchdog's weekly
  all-clear fires at 12:00 UTC. If no all-clear arrived in Slack today, that
  is itself the alarm and is worth 5 minutes before anything else.
- Tree clean, HEAD == origin. Last 3 commits are the 429 fix.
- Tests: **572 passing**. Lint, typecheck, build all green. CI green.

### Tag data, measured (this decides the whole filter redesign)

| Field | Distinct values | Rows with NONE |
|---|---|---|
| `subject_area` | 26 | **0** |
| `practice_areas` | 25 | 127 |
| `industries` | 24 | **244 (44%)** |

**This is the strongest argument for the mentor's direction.** Subject is on
100% of rows; industry is missing from nearly half. The two fields currently
given the most table width are the two least populated. Top subjects:
Establishing Dates of Importance (126), Trade (93), National Security/Defense
(76), Environment/Energy (48), Foreign Affairs (42).

## WHAT THE MENTOR FOUND — each item reproduced

His framing: *"Nothing is broken. This is about how it feels."*

### 1. Search doesn't switch to relevance sort — REPRODUCED EXACTLY

Live query `tariff OR duty`, 164 matches either way:

- `sort=date` (the default) → top 3: *Constitution Day, Citizenship Day and
  Constitution Week 2026*; *Patriot Day 2026*; *Excluding Certain Canadian
  Products…*
- `sort=relevance` → top 3: *Amendment to Reciprocal Tariffs and Updated
  Duties…*; *Adjusting Imports of Medium- and Heavy-Duty Vehicles…*;
  *Imposing Additional Duties To Offset Canadian Discrimination…*

He is exactly right, including the 164 figure in his mockup. **This is the
highest value-per-line change on the list and needs no migration.** The
relevance ranking already works — `search_vector` weights title/EO number as
'A', summary and tags 'B', body text 'D' (migration 0007). Nothing reaches
it because `DEFAULT_SORT = "date"` in `src/lib/tracker-query.ts:19`.

Note the current UI actively *discourages* relevance: the option is
`disabled` unless a search term exists, labelled "Most relevant (type a
search first)" — `src/components/tracker-controls.tsx:181`.

**Where to fix:** `parseTrackerQuery` in `src/lib/tracker-query.ts`. Default
to `relevance` when `search` is non-empty *and the URL carries no explicit
sort*, so a deliberate switch back to date order still survives paging and
sharing. It is a pure function with an existing test file
(`src/lib/tracker-query.test.ts`) — easy to cover properly.

### 2. Table gives the title the least room, tags the most — CONFIRMED

`src/components/eo-table.tsx` is 99 lines, 7 columns, `min-w-[900px]`:
EO Number | Title | Date Signed | Status | Practice Areas | Industries |
Legal Challenges. No width control anywhere, so the browser hands the tag
columns as much room as their content wants. Titles wrap to six lines and
about three orders fit on screen.

The mockup's answer: one dense row per order — number/type and date in a
narrow left rail, **title large**, AI summary beneath it, subject tags
beneath that, practice area and industry demoted to a small grey subtitle
line, status and challenges right-aligned. Given the tag-population table
above, that ordering matches the data.

### 3. Sideways scroll on a laptop; Legal Challenges off the right edge

Caused by `min-w-[900px]` plus 7 columns with unconstrained tag cells.
Target 1440px with no horizontal scroll.

### 4. Phone shows only number and title — "Partners will open this from
email on their phones"

Mockup page 3: one card per order, no table, filters become a horizontally
scrolling row of buttons. Target 390px.

### 5. Subject should be a dropdown, not something people type — CONFIRMED,
and this one is bigger than it looks

**There is no subject filter today at all.** `subject_area` renders as tag
pills in the table (`eo-table.tsx:54-60`) but there is no dropdown, and
`TrackerQuery` has no `subjects` field. The only way to filter by subject is
to type the words into the full-text search box and hope.

The list already exists: `src/config/subject-areas.json`, 26 entries, all 26
in live use, exposed as `SUBJECT_AREAS` in `src/lib/taxonomy.ts:79`.

**This needs a migration.** `search_executive_orders` (migration 0008) has no
subject parameter. See "The migration" below.

## THE MIGRATION — read this before planning

Three of the mentor's ideas all land on the same Postgres function, so they
should be **one migration, not three**:

1. **Subject filter** — add `p_subjects text[]`.
2. **Search snippets with highlighted terms** ("show the section of text
   containing the search terms below the title") — this is `ts_headline()`
   over `full_text`, which means a new column in the function's
   `RETURNS TABLE`.
3. **Per-option counts in the filter dropdowns** — see the open question
   below; may be a second function rather than a change to this one.

### The trap, documented in 0008's own header

Changing the parameter list **changes the function's type signature**, so
`create or replace` does *not* replace it — it creates a second overload, and
PostgREST then sees two candidates with the same name and fails. Migration
0008 handles this with an explicit `drop function if exists` naming the full
old signature first. **0009 must do the same**, naming 0008's signature:

```
drop function if exists search_executive_orders(
  text, text[], text[], text, date, date, text, integer, integer);
```

### The other rule that applies

**Never edit an applied migration file in place.** Supabase tracks by
filename; editing 0001 after it was recorded as applied meant every later
edit silently never reached the live database. Always add a new file.

### And the deployment rule

Pushing a migration to this branch **is** the apply step — there is no
separate command. So the SQL gets reviewed as carefully as a direct
production change, **before** the push. Show me the SQL. I will say yes or no.

## OPEN QUESTIONS — only I can answer these

Ask them as a Q&A before writing code.

1. **Filter counts: global or faceted?** The mentor wants a count beside each
   dropdown option "so nobody lands on an empty page". Two readings:
   - *Global* — "Trade (93)" always. One cheap query, cacheable, never
     changes as you filter. But you can still land on an empty page by
     combining Trade with an industry that shares no rows.
   - *Faceted* — counts recomputed against whatever else is currently
     selected, so they always tell the truth. This is what actually delivers
     his stated goal, and it is meaningfully more work: a second RPC on every
     render, and a decision about whether a facet counts against its own
     filter or excludes it.
   My read: faceted is the real answer, global is the demo-safe answer.

2. **What does "export the underlying order and work product" mean?** Today
   the *drafter* exports (.docx and markdown, gated behind a "reviewed for
   accuracy" checkbox — `src/components/content-drafter.tsx:102-118, 248`).
   The *EO detail page* exports nothing. Candidates: the order's full text as
   .docx; a one-page brief (title, dates, status, summary, tags, challenges);
   or just a prominent link to the authoritative govinfo.gov PDF. **Note the
   README's source-reliability caveat**: federalregister.gov's text is "not
   an official legal edition", and anywhere we assert content as
   authoritative we are supposed to cite the linked PDF. An export that looks
   like a legal document raises that stake.

3. **What exactly should "Draft Content" be renamed to, and what does
   "pinned" mean?** You suggested "Create Alert/Content". Pinned = a visually
   primary button in the header (filled, not a text link), or something that
   follows you down the page, or an action on each row? The nav is
   `src/components/site-header.tsx:3-9`, five equal-weight text links.

4. **Clickable tags — which filter does a subject tag apply?** Requires the
   subject filter (Q5/migration) to exist first. Also: does clicking a tag
   *replace* the current filters or *add* to them?

5. **Is "Subject" the right word for the demo audience?** The mockup leads
   with it and demotes practice area and industry. The data supports that.
   But practice area is the firm's own language and the reason the tool
   exists. Confirm the hierarchy before it's baked into the layout.

6. **Design system: adopt shadcn/ui, or stay hand-rolled?** You mentioned
   "using a design skill". Being straight with you about what exists: there
   is a `vercel:shadcn` skill (component library guidance) and a
   `vercel:react-best-practices` skill. There is **no** general "make it
   prettier" skill for a Next.js app — `artifact-design` is for Claude
   Artifacts, not this codebase. Adopting shadcn means new dependencies and
   converting existing components; staying hand-rolled means continuing with
   the Tailwind tokens in `src/app/globals.css`. **For a demo this week I'd
   stay hand-rolled** and spend the time on layout and hierarchy, which is
   what the mentor actually criticised.

7. **Is the placeholder palette still acceptable?** `globals.css:3-9` says in
   its own comment that the colours are *inferred from the public Sheppard
   site*, a placeholder pending real brand assets (hex codes, logo, fonts).
   The mockup uses these same colours. If real assets exist, now is the
   moment.

## THE FILES YOU WILL TOUCH

| File | Lines | Role |
|---|---|---|
| `src/components/eo-table.tsx` | 99 | The results table. The main event. |
| `src/components/tracker-controls.tsx` | 230 | Search box + all filter dropdowns. **Close to the 300-line ceiling — plan to split, not grow.** |
| `src/components/multi-select-filter.tsx` | 88 | The `<details>`-based checkbox dropdown. Counts go here. |
| `src/components/tag-pill.tsx` | 17 | Becomes clickable. |
| `src/components/site-header.tsx` | 35 | Nav rename + pinning. |
| `src/lib/tracker-query.ts` | ~120 | URL state. Relevance auto-switch lives here. Has tests. |
| `src/lib/executive-orders-search.ts` | 119 | Calls the RPC. New params thread through here. |
| `src/lib/executive-orders-search-local.ts` | — | **Don't forget this one.** The no-database fallback used in local dev; it must implement any new filter too or dev and production diverge. |
| `src/app/page.tsx` | 51 | The tracker page. |
| `supabase/migrations/0009_*.sql` | new | Subject filter + snippets. |

## RULES THAT WILL BITE ON THIS PARTICULAR JOB

- **Files ≤300 lines.** `tracker-controls.tsx` is at 230 and you're adding a
  Subject dropdown and possibly counts. Split it up front.
- **Every feature ships with a test** (rule 9). **Phase 1 UI currently has
  zero test coverage** — CLAUDE.md says don't retrofit en masse, but *do*
  bring a file under test when you're already in it. You will be in all of
  them. `tracker-query.ts` and `tracker-pagination.tsx` already have tests;
  `eo-table.tsx` and `tracker-controls.tsx` do not. Budget for this.
- **This is Next.js 16.3.4 and it differs from training data.** `AGENTS.md`
  requires reading `node_modules/next/dist/docs/` before writing Next code.
  It has already mattered once: `error.tsx`'s prop is `retry`, not `reset`.
- **Any new compound tag scheme must update `search_executive_orders`.** The
  `Governmental--National Security` separator silently broke filtering until
  0008 fixed it.
- Don't bypass a gate (CI, lint, typecheck) silently. Say so and get
  agreement.

## HOW TO SEE YOUR WORK

`.claude/launch.json` exists locally but is **untracked** — it's what lets
the dev server be started from a session. Use the preview tooling rather than
asking me to check manually, and verify at **1440px and 390px**, which is
what the mentor asked for.

To test error paths, create `.env.development.local` with a bad
`NEXT_PUBLIC_SUPABASE_ANON_KEY` (it overrides `.env.local` in dev and is
gitignored). **DELETE IT AFTERWARDS.**

## SUGGESTED ORDER (demo is this week)

**Phase 1 — no migration, all visible, safe to ship immediately**
1. Relevance auto-switch on search. Smallest change, biggest perceived fix.
2. Results row redesign: title gets the room, tags demoted to a subtitle.
3. No sideways scroll at 1440.
4. Phone cards at 390.
5. Rename + pin "Draft Content".

Stop here and it is already a materially better demo, with zero database risk.

**Phase 2 — the migration, once I've approved the SQL**
6. Subject dropdown (`p_subjects`).
7. Search snippets with highlighted terms (`ts_headline`).
8. Clickable tags (depends on 6).

**Phase 3 — if time allows**
9. Filter counts (answer Q1 first).
10. Export from the EO detail page (answer Q2 first).

## KNOWN GOTCHAS CARRIED FORWARD

- Live `executive_orders` ids are UUIDs; legacy JSON ids are `legacy-eo-N`.
  They can never match — CLAUDE.md was wrong about this once and it changed
  which pages a bug actually affected.
- A failed Supabase read now **throws** rather than silently serving
  January's spreadsheet. `src/app/error.tsx` catches it. Don't reintroduce a
  fallback that makes stale data look live.
- `document_number` is UNIQUE.
- `/api/cron/*` sits deliberately outside the (currently inactive) password
  proxy matcher. If you touch the matcher, re-verify a cron request still
  returns JSON and an unauthenticated one still returns 401.
- The drafting/prompt pages ship their HMAC token to the browser — it stops
  scrapers, not people. The 20/hour ceiling is what bounds the bill. Known
  and accepted.
- Practice-area and subject tags are AI-generated with **no ground truth**.
  Nothing has independently checked them. Worth knowing before a demo puts
  them on screen at full size.

## STILL OPEN FROM THE LAST SESSION (not UI work — don't start it here)

- **A revoked order never updates its status.** `syncDocument` returns
  `unchanged` on a `document_number` match and never re-reads the disposition
  notes, so an order stored as `active` stays `active` even after a later EO
  revokes it. All 46 non-active rows got their status at first ingest.
  Found in review, confirmed against live data. For a law firm's tracker this
  is the most consequential open item — but it is backend work, and it is not
  what this session is for.
- Review flags can't be cleared (`needs_review` isn't in `CORRECTABLE_FIELDS`).
- 30 ambiguous docket matches need my decisions in
  `data/legal-challenge-links.json`.
- CLAUDE.md is at its 250-line ceiling; last session's work isn't recorded
  in it yet.

## HANDY COMMANDS (PowerShell, absolute paths)

```
cd C:\Users\jchog\residency\ExOrd_Insights ; npm run test
cd C:\Users\jchog\residency\ExOrd_Insights ; npm run lint ; npm run typecheck
cd C:\Users\jchog\residency\ExOrd_Insights ; npm run dev
```

Prove the alert channel end to end:
```
curl -s -H "Authorization: Bearer $env:CRON_SECRET" "https://ex-ord-insights.vercel.app/api/cron/watchdog?verify=1"
```
