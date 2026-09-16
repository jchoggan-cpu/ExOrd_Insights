@AGENTS.md

# Engineering & code hygiene rules — Sheppard EO Tracker

Adapted from `CODE-HYGIENE-STARTER_2.md` and `ENGINEERING-HYGIENE-STARTER.md`
(`~/OneDrive/2026 LQ Residency/`), scaled down for this project's actual size
(one law firm, one developer, pre-production). Full originals are the source
of truth for the general reasoning; this file is what's actually enforced
here, plus this project's own status against each rule.

**These are standing instructions.** Apply them to all work in this repo
without being asked again.

## Code rules (every session, every file touched)

1. **Files ≤300 lines.** Split before that, no silent exceptions.
2. **One job per file, one job per function.** If describing it needs "and", split it.
3. **Dependencies passed in, not reached for.** A function that needs the
   Supabase client or the Anthropic client takes it as a parameter/argument;
   it doesn't import and instantiate its own. Lets it be tested with a fake
   client instead of the real service.
4. **No secret failures.** Every `catch` either fixes the problem, logs what
   failed and the input then stops/reports, or carries a comment saying why
   swallowing it is genuinely safe. Empty `catch {}` is banned.
5. **No magic numbers/strings.** Name it as a constant (see rule 6).
6. **Settings live in one place.** No new code reads `process.env` directly —
   route it through `src/lib/site-auth.ts`-style single access points, so a
   missing var fails loudly at startup, not mid-request. Secrets only via
   `.env.local` (gitignored) or the deployment's env vars, never in code.
7. **Names a stranger understands.** `dateSigned`, not `d`.
8. **Delete dead code, don't comment it out.** Git remembers it.
9. **Every feature ships with a test.** `npm run test` (Vitest) must cover the
   new logic. If something's awkward to test, that's usually a rule-3
   violation — fix the design.
10. **Small commits, one change at a time,** message says what and why.

## Setup rules — status in this repo

| Rule | Status here |
|---|---|
| Cloud CI blocks bad changes | ✅ `.github/workflows/ci.yml` — lint, typecheck, test, build on every push/PR. Extend this file's steps rather than inventing a parallel check. |
| Pin every tool version | ✅ All of `package.json` pinned exact (no `^`/`latest`); `engines.node` and the CI workflow's `setup-node` both pin `24.19.0` so local and CI never drift apart. Repin both together when Node is upgraded. |
| Local ports <49152 | ✅ N/A today — Supabase is hosted, dev server is Next's default (3000). Revisit only if a local service is ever added. |
| Generated files saved + CI-compared | Not yet applicable — no code generation step exists yet. Once Supabase is live, `supabase gen types typescript` output should be committed and CI should regenerate + diff it (add to the ledger below when that happens). |
| Manual-steps ledger | ✅ See below. |
| Environment fully documented | ✅ README.md's "Environment variables" + "Setting up Supabase" sections; CI proves the recipe actually works headless. |
| Team-of-AIs for substantial work | **Adopted 2026-09-13, in two layers.** *Runtime*: each AI task in the app routes to its own model through `src/lib/ai-model.ts` (content drafting, summarization, classification), so a task's cost matches its difficulty rather than inheriting one default. Add a task by adding a `get*Model()` there — never a second access point. *Development*: mechanical, well-specified, independently-verifiable work (lookup tables, snapshots, scaffolding) goes to subagents on cheaper models; design, live-data writes, migrations, and final verification do not. **Every subagent claim is re-verified against live state before it is acted on** — subagents cannot see this project's history of bugs that were invisible until checked directly. Still required regardless of layer: (a) state the plan before coding, (b) run the `code-review` skill as an adversarial pass before calling it done. |

## Known test gaps

- **No end-to-end test.** Nothing automatically proves a real user can go
  tracker → EO detail → draft content → export, start to finish.
  **Status: accepted for now** (pre-production, one user). Revisit — build one
  E2E test of that exact journey — the moment a second real user depends on
  this tool.
- **Phase 1 UI (tracker table, EO detail page, content-drafting UI) has zero
  test coverage.** Not being retrofitted en masse — rule 9 applies to code
  written or touched from here forward; bring a file under test when you're
  already in it for another reason, not as a separate sweep.
- ~~**The three Federal Register job orchestration functions** are not
  integration-tested~~ **Closed (2026-09-09).** All three jobs plus the
  overlap guard are covered via `test-support/fake-supabase.ts`, and the
  Federal Register fetchers and Anthropic client are injectable (rule 3) so
  no test makes a network call. A stuck-`running` row that permanently
  jammed the guard was found and fixed at the same time
  (`STALE_RUN_THRESHOLD_MINUTES`, `finishRunSafely`). Full writeup in
  `git log 2026-09-09`.
- **`ingest-job.ts`/`enrich-job.ts`/`reconcile-job.ts` share a lot of
  structural duplication** (a near-identical fetch/sync/tally loop, near-
  identical result interfaces, near-identical try/catch/finishRun-on-failure
  boilerplate) that an adversarial review pass flagged and a consolidation
  would clean up. **Status: accepted for now** — deferred rather than risking
  a rushed refactor across three files right before the first real run;
  worth doing as its own follow-up once the pipeline has run live at least
  once.

## Resolved — RLS anon-read gap (was "Known blocking issue")

Found by adversarial review, pre-existing: SELECT policies on
`executive_orders`, `ingestion_runs`, `rescinded_prior_orders` and
`agency_actions` required `auth.role() = 'authenticated'` or `is_admin()`,
but Supabase Auth (Phase 5) doesn't exist, so no anon-client read could ever
satisfy them. Every tracker, EO-detail and Needs-Attention read would have
been silently RLS-denied and fallen back to `[]` or stale JSON, with no
error anywhere.

**Decision (2026-09-07):** loosen those four to `using (true)` — see
`0002_loosen_read_policies.sql`. The real boundary today is `SITE_PASSWORD`
(`src/lib/site-auth.ts`), so those policies were unreachable by design, not
a deliberate restriction. Writes are unchanged — `is_admin()`-gated, and
only reachable via the service-role key the jobs use.

**Revisit at Phase 5**: once real per-user accounts ship, tighten these four
SELECT policies back (e.g. to `auth.role() = 'authenticated'` or a
role-aware policy) — `0002`'s own header comment says the same.

## Supabase project is connected (2026-09-08)

Project `tjnenceabzlvgozplpsp` ("EO Tracking Tool"). Migrations through 0008
are live — **verify directly** against `pg_policies`/`information_schema`/
`pg_proc`, never the migration-history log alone; that is what caught both
issues below. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET` and `ANTHROPIC_API_KEY` are set
in `.env.local`; the first four plus `EO_TRACKER_MODEL` are in Vercel.
Vercel won't read a Secret-type value back via CLI once set.

**Important workflow change**: the Supabase project's GitHub integration
auto-deploys everything in `supabase/migrations/` on every push to
`claude/eo-tracker-planning-z0unry` — confirmed by observing migration
`0002` go live immediately after an ordinary `git push`, with no separate
apply step. A new migration file is no longer a "safe until manually run in
the SQL Editor" change — **pushing it to this branch is the apply step.**
Review migration SQL as carefully as you would a direct production change,
before pushing, not after.

**New rule: never edit an already-applied migration file in place.**
`0001_init.sql` was edited across four commits as the schema grew (Phase 1
→ legacy import → safety mitigations → Phase 2), instead of being extended
via new migration files each time. Supabase's push/GitHub-integration
tracking works by filename, not content — once "0001" was recorded as
applied (against an early version of the file), every later edit to that
same file silently never reached the live database, and `create table if
not exists` masked it further by no-op'ing instead of erroring. This wasn't
caught until the Federal Register backfill failed with a missing-column
error — see `0004_reconcile_executive_orders_drift.sql` for the fix and the
full diagnosis. Going forward: always add a new migration file for schema
changes, even a small one, never edit a migration that may already be live.

**Also discovered (0003)**: this project's `postgres` role had default
table privileges for `anon`/`authenticated`/`service_role` missing
`select`/`insert`/`update`/`delete` entirely — a genuine Postgres-level
grant gap (not an RLS policy issue), most likely because the project was
provisioned through Vercel's Marketplace integration rather than
supabase.com directly, which appears to skip Supabase's usual
default-privilege bootstrap. Fixed for existing tables and defaulted going
forward; if this project is ever recreated from scratch the same gap should
be expected and checked for.

**Also present, unused**: the marketplace integration added ~16 further env
vars (`*JCHLQSUPABASE*`, `*PUBLISHABLE*`, `SUPABASE_JWT_SECRET`,
`POSTGRES_*`). This app reads only the three names in `src/lib/supabase.ts`.
Harmless clutter; safe to delete, not urgent.

## Enrichment backlog cleared (2026-09-12)

`npm run enrich:all -- --apply` summarized all 276 queued rows in 14 passes
for **$15.98**, so every one of the 614 tracker rows now has a summary. Four
things worth keeping:

- **Prompt caching is load-bearing, and fails silently.** The ~3,300-token
  system prompt is cached, read thereafter at a tenth the input rate.
  `/usage` gives cache-read tokens their own column for exactly that reason:
  if it hits 0 mid-run the bill roughly doubles with nothing else looking
  wrong.
- **Estimating from a handful of calls is unreliable.** Six calls projected
  $8-9 against an actual $15.98. Price a run from a full pass or `/usage`.
- **Resumability earned its keep.** A Gateway Timeout killed one row; the
  next pass picked it up unaided, since each selects only `ai_summary IS
  NULL`. Interrupting `enrich:all` is always safe.
- **Two rows were flagged** by quote verification and left unsummarized —
  see `/needs-attention`.

Outcome: median 83 words (the firm's hand-written median is 67), zero
multi-paragraph summaries, 0% empty subject areas. Practice-area coverage
was poor then (54% empty) — **fixed 2026-09-15**, see below.

## Summary quality audit (2026-09-12)

`verify-facts.ts` checks the hard facts in every summary — deadlines, money,
percentages, statutory citations, instrument numbers, dates — against that
row's `full_text`. Run over all 498 summarized rows with source text, it
found **759 checkable facts** and, after the checker's own false positives
were fixed, **4 flags**:

- **Zero confirmed fabrications in the 276 AI-written summaries.** Every
  flag traced to the checker's formatting assumptions, not the model.
- **One genuine defect, and it was the firm's own**: `EO 14183` carried a
  legacy summary describing a different document. **Corrected 2026-09-15**
  via `npm run correct` — see `data/data-corrections.json`.

The first pass flagged 19 rows; 15 were the checker being wrong, and
handling those formatting differences (spelled-out deadlines, ".15 percent",
"$125 million" vs "$125,000,000", reformatted statutory citations) is most
of what `verify-facts.ts` now does — each a regression test. **Read a flag
as "look at this", never as "this is wrong"**: the check only asks whether a
figure appears in the source, not whether it attaches to the right actor.

## Practice-area tagging (2026-09-15)

Tagging went from 128 of 615 rows to 467; every row still untagged is
ceremonial (Labor Day, memorials, heritage months), where empty is correct.
Four things worth keeping:

- **Classification is its own task with its own model.** It was welded into
  summarization, so re-tagging would have regenerated the firm's 338 curated
  summaries; `npm run classify` writes tags only. Routes via
  `EO_TRACKER_CLASSIFY_MODEL` (Sonnet 5, ~$5 a corpus) while summarization
  stays on Fable 5 (~$29) — chosen by a bake-off, not assumed.
- **Loose criteria cost more than model choice.** Tightening Litigation and
  Tax moved average tags per row 2.40 → 1.95 with the model held constant.
  Fix criteria before paying to apply them 600 times.
- **A tag on most of the corpus cannot filter.** `Governmental` reached 70%,
  so it is subdivided into the firm's nine subgroups, stored as
  `Governmental--National Security`. Largest tag is now 36%. The firm's
  rules about which form wins are enforced in `classify-document.ts`, not in
  the prompt — the pilot proved the model returns both when merely asked not
  to.
- **Subgroups broke the filter, silently.** Exact array matching meant
  selecting `Governmental` matched almost nothing; migration 0008 matches a
  parent OR any subgroup. Any future compound tag must update it too.

## Manual-steps ledger

Steps that need a human, can't be automated away, and how to tell they're done:

| Step | Where | Done when |
|---|---|---|
| Run `npm run import:supabase` once (loads the 340 legacy rows) — **not safe to re-run**, only after confirming the tables are empty | local machine, after `.env.local` has real Supabase keys | Rows visible in Supabase's Table Editor |
| Run `npm run backfill:federal-register` once, after `import:supabase` | local machine | `/needs-attention` shows recent runs and the tracker's order count jumps to match the administration-to-date total |
| Set `AI_GATEWAY_API_KEY` (from Vercel > AI Gateway > API Keys) in `.env.local` and in Vercel, to route Claude calls through the gateway instead of the Anthropic API directly | Vercel dashboard / `vercel env add` | An enrichment run logs "Vercel AI Gateway"; requests appear in the AI Gateway overview |
| **Check the Anthropic balance before a large run.** Auto-reload is on, so the `$4 remaining` figure in older notes was wrong — `/usage` records what this app spent ($16.10 through 2026-09-14), never the balance. Only the Console shows that | Anthropic Console | Balance and auto-reload both confirmed, with headroom |
| Set a monthly spending cap — on the AI Gateway budget if routing through it, otherwise on the Anthropic API key | Vercel AI Gateway settings / Anthropic Console | Cap visible in that product's billing limits page |
| Review the derived summarization prompt at `/prompt`. (The practice-area `criteria` were reviewed 2026-09-15: Litigation and Tax tightened, Governmental subdivided — the prompt itself is still a first pass distilled from the firm's summaries, not firm-authored) | the app | You've read it once and edited or accepted it |
| Decide whether `Congressional Investigations` earns its place — it drew 0 of 615 rows, so it is a filter option that never matches | `src/config/practice-areas.json` | Kept deliberately, or removed |
| Run `npm run draft:summaries -- --apply --limit N` in batches against the 222 curated rows that have full text, then compare on each EO page. Watch `/usage` between batches — see the credit row above | local machine | Drafts visible beneath the curated summaries |
| Set `SITE_PASSWORD` if sharing a deployed URL pre-auth | deployment env vars | `/gate` prompts before the app loads |
| Review `data/legal-challenge-links.json`, paste a candidate's `docketId` into `chosenDocketId` for entries marked `ambiguous`, then `npm run link:dockets -- --apply` | editor, then local machine | Docket links show on EO detail pages; the file's `ambiguous` count is 0 or knowingly accepted |
| Optional: set `COURTLISTENER_API_TOKEN` (free, from courtlistener.com) to lift the anonymous rate limit | `.env.local` | A full `link:dockets` run finishes with no 429 backoffs |

When this list passes ~5 items, review whether any can now be automated (per
the source rule).

## Working practices

- **Plan before code** for anything non-trivial: which files, what changes, in
  plain English, before implementing.
- **Report what changed and why** after each change, naming which rules above
  were engaged — flag anything that bends one rather than bending it quietly.
- **Never bypass a gate (CI, lint, typecheck) silently.** If one has to be
  skipped, say so explicitly and get agreement first.

## Editing these rules

This is a plain markdown file — edit it directly, or just tell Claude in chat
("add a rule that...", "drop the port-number rule, it doesn't apply") and it
will update this file immediately. Keep the whole file under ~250 lines —
every line here competes for attention in every session.
