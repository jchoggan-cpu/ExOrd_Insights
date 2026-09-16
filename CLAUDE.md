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
| Generated files saved + CI-compared | ⚠️ Now applicable, not done. Supabase is live, so `supabase gen types typescript` output could be committed and CI could regenerate + diff it. Today the schema is mirrored by hand in `src/lib/types.ts`, which is exactly the drift this rule exists to catch. |
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
- **A failed query silently serves January's spreadsheet** (rule 4 violation,
  found 2026-09-16, unfixed). `getExecutiveOrders`, `getExecutiveOrderById`,
  `getExecutiveOrdersByIds` and both reads in `data.ts` fall back to the
  bundled legacy JSON on error with only a `console.error`; the "showing
  spreadsheet data" banner is gated on `isUsingLocalData()`, which asks only
  whether Supabase is *configured*. So a query failure shows 340 stale rows
  that look live — on the EO detail page and the content drafter, the two
  places stale text reaches a client. `searchExecutiveOrders` already throws
  instead; these should too, or the banner must learn the difference.
- ~~Federal Register job orchestration is not integration-tested~~ **Closed
  2026-09-09** — all three jobs plus the overlap guard are covered via
  `test-support/fake-supabase.ts`, with every network dependency injectable
  (rule 3). See `git log 2026-09-09`.
- **`ingest-job.ts`/`enrich-job.ts`/`reconcile-job.ts` share a lot of
  structural duplication** (near-identical fetch/sync/tally loop, result
  interfaces, and try/catch/finishRun boilerplate) that an adversarial review
  flagged. It was deferred until the pipeline had run live at least once —
  **that condition is now met**, so this is a live candidate rather than a
  parked one. Note the jobs are no longer as symmetrical as they look:
  `enrich` builds an Anthropic client and loads the stored prompt, and
  `ingest` carries the duplicate guard, so consolidate the shared shell only.

## Resolved — RLS anon-read gap (2026-09-07)

SELECT policies on `executive_orders`, `ingestion_runs`,
`rescinded_prior_orders` and `agency_actions` required an authenticated role
that Phase 5 hasn't built, so no anon read could ever satisfy them — every
tracker and detail read would have been RLS-denied and fallen back to stale
JSON with no error anywhere. Loosened to `using (true)` in
`0002_loosen_read_policies.sql`; there is no read boundary today at all.
Writes are unchanged, `is_admin()`-gated and service-role only.

**Revisit at Phase 5**: once real per-user accounts ship, tighten those four
SELECT policies back — `0002`'s own header comment says the same.

## Supabase project is connected (2026-09-08)

Project `tjnenceabzlvgozplpsp` ("EO Tracking Tool"). Migrations through 0008
are live — **verify directly** against `pg_policies`/`information_schema`/
`pg_proc`, never the migration-history log alone; that is what caught both
issues below. `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, `CRON_SECRET`, `ANTHROPIC_API_KEY` and
`REQUEST_TOKEN_SECRET` are set in `.env.local`; those six plus
`EO_TRACKER_MODEL` are in Vercel (`SITE_PASSWORD` removed 2026-09-16).
**Vercel won't read a Secret-type value back via CLI, so "the variable is
listed" is not evidence it holds anything** — see Production environment
below for the eight nights that cost.

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

**Also discovered (0003)**: default table privileges for
`anon`/`authenticated`/`service_role` were missing entirely — a Postgres
grant gap, not an RLS issue, most likely because the project came via
Vercel's Marketplace rather than supabase.com. Fixed and defaulted forward;
expect and check for it if this project is ever recreated.

**Also present, unused**: the marketplace integration added ~16 further env
vars (`*JCHLQSUPABASE*`, `*PUBLISHABLE*`, `SUPABASE_JWT_SECRET`,
`POSTGRES_*`); this app reads only the three in `src/lib/supabase.ts`.

## Lessons that change how to work here

Distilled from the sessions that produced them; the narratives are in
`git log` and README.md. Figures below are true as of their date.

**Verify against live state — including against this file.** Nearly every
real bug here was invisible until someone checked directly: the migration
that silently never applied (`0004`), the stuck `running` row that jammed
the ingest guard, RLS policies no anon read could satisfy, 62 duplicate rows
nothing flagged, and a production cron that failed eight nights running.
Counts and costs written here are the first thing to re-check, never to cite.

**Match on a field and you have decided which records you cannot see.** The
backfill reconciled the two data sources on `eo_number`; proclamations and
memoranda have none, so 62 were duplicated instead of merged — and the
duplicate *check* compared EO numbers too, so nothing flagged it. Before
matching on any field, ask which rows lack it.

**A guard that defaults instead of stopping guesses wrong quietly.**
`merge-rules.ts` refuses to run when a column has no explicit rule, because
the first version defaulted to one side and would have kept four stale
`"Pending Federal Register Publication"` values without a word.

**Price a run from a full pass, not a sample.** Six calls projected $8–9
against an actual $15.98. `/usage` records what this app has *spent*, never
the balance — auto-reload means only the Anthropic Console shows that.

**Prompt caching is load-bearing and fails silently.** A cache-read of 0
during a *bulk* run means the bill roughly doubled with nothing else looking
wrong. Zero on a one-row cron run is normal — an ephemeral cache lives ~5
minutes, so a single call never reads one back.

**A tag on most of the corpus cannot filter, and fixing criteria beats
changing models.** Tightening Litigation and Tax moved tags per row 2.40 →
1.95 with the model held constant; `Governmental` hit 70% and had to be
subdivided into `Governmental--National Security` form. **Any future
compound tag must also update `search_executive_orders` in migration 0008** —
introducing that separator silently broke the tracker's filter until 0008
fixed it. Which tag form wins is enforced in `classify-document.ts`, not the
prompt: the pilot proved the model returns both when merely asked not to.

**Read a verification flag as "look at this", never "this is wrong".**
`verify-facts.ts` found 759 checkable facts across the summarized corpus and
**zero confirmed fabrications** in the AI-written summaries; the one genuine
defect was the firm's own (`EO 14183`, corrected via `npm run correct`). It
only asks whether a figure appears in the source, not whether it attaches to
the right actor.

**Enrichment is always safe to interrupt.** Every pass selects only
`ai_summary IS NULL`, so Ctrl-C, a spend cap or an outage leaves finished
rows finished.

## Production environment (2026-09-16)

- **`SITE_PASSWORD` was removed 2026-09-16** so the tracker could be shared
  freely; the gate machinery stays in the repo, dormant, and re-adding the
  env var plus a redeploy turns it back on in ~30 seconds. It needs no paid
  Vercel plan (their Deployment Protection is the paid one). `/api/cron/*`
  is excluded from the proxy matcher deliberately: those routes answer to
  `CRON_SECRET` and must return JSON, not a redirect — re-verify both if the
  matcher ever changes.
- **The two write routes are protected by a token, not by auth.**
  `/api/generate-content` and `/api/summary-prompt` verify a 12-hour HMAC
  token minted per page render, plus a 20/hour global spend ceiling on the
  former. The token ships to the browser, so it stops scrapers and not
  people — do not mistake it for access control. There is no refresh
  endpoint, because an unauthenticated minting endpoint would defeat it.
- **A Vercel env var can exist and still be empty, with nothing to say so.**
  `ANTHROPIC_API_KEY` was registered but blank, so the nightly enrich job
  failed eight nights running while ingest succeeded beside it. A *wrong*
  key returns 401 from Anthropic; our own "No AI credentials configured"
  error means the stored value is empty. And env changes reach only new
  deployments — a redeploy is part of the fix, not optional.
- **Nothing alerts.** Every failure — dead cron, flagged hallucination, API
  outage — surfaces only on `/needs-attention`, which a human has to open.
  The single biggest structural gap in the project.

## Manual-steps ledger

Steps that need a human, can't be automated away, and how to tell they're done:

| Step | Where | Done when |
|---|---|---|
| **Check the Anthropic balance before a large run.** `/usage` records what this app has *spent* ($24.69 all-time through 2026-09-16), never the balance; auto-reload is on, so only the Console shows it | Anthropic Console | Balance and auto-reload both confirmed, with headroom |
| Review the derived summarization prompt at `/prompt`. `summary_prompts` is still empty, so every summary to date used the built-in default. (Practice-area `criteria` were reviewed 2026-09-15; the prompt itself is still a first pass distilled from the firm's summaries, not firm-authored) | the app | You've read it once and edited or accepted it |
| Review `data/legal-challenge-links.json`, paste a candidate's `docketId` into `chosenDocketId` for the 30 entries marked `ambiguous`, then `npm run link:dockets -- --from-file --apply` | editor, then local machine | Docket links show on EO detail pages; the file's `ambiguous` count is 0 or knowingly accepted |
| Fix the 3 rows with malformed `action_type` (two `"Pending Federal Register Publication"`, one `"Proclamation 10973"`) — none has a Federal Register counterpart to correct it automatically | `npm run correct` | `npm run diagnostics` shows only real instrument types |
| Decide whether `Congressional Investigations` earns its place — it drew 0 of 553 rows, so it is a filter option that never matches | `src/config/practice-areas.json` | Kept deliberately, or removed |
| Run `npm run draft:summaries -- --apply --limit N` in batches against the 221 curated rows that have full text, then compare on each EO page. Watch `/usage` between batches | local machine | Drafts visible beneath the curated summaries |
| Set `REQUEST_TOKEN_SECRET` in Vercel (`openssl rand -hex 32`) — without it `/api/generate-content` and `/api/summary-prompt` refuse every request and the Generate/Save buttons render disabled | `vercel env add` + redeploy | Generating a draft on the deployed site works |
| Optional: set `AI_GATEWAY_API_KEY` to route Claude calls through Vercel's AI Gateway instead of the Anthropic API directly | Vercel dashboard / `vercel env add` | An enrichment run logs "Vercel AI Gateway" |
| Optional: set `COURTLISTENER_API_TOKEN` (free) to lift the anonymous rate limit | `.env.local` | A full `link:dockets` run finishes with no 429 backoffs |

Done and removed: `import:supabase`, `backfill:federal-register`, the spend
cap, and `SITE_PASSWORD` (set then deliberately removed — see above).

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
