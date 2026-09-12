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
| Team-of-AIs for substantial work | **Adapted, not adopted as written** — the starter assumes a multi-model swarm; this is a one-developer project where that overhead isn't warranted. Substitute: for anything bigger than a small fix, (a) state the plan before coding, (b) after finishing, run the `code-review` skill (or a fresh look) as an adversarial pass asking "did it build exactly what was asked?" and "is it well made?" before calling it done. |

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
  integration-tested~~ **Closed (2026-09-09).** `ingest-job.test.ts`,
  `enrich-job.test.ts`, `reconcile-job.test.ts`, and `ingestion-run.test.ts`
  now cover all three jobs (happy path, per-item error isolation, "the list
  request itself fails") plus the overlap guard specifically (blocks a
  second concurrent run; releases on both the success and failure paths),
  via an extended `test-support/fake-supabase.ts` (now also handles
  `.insert().select().single()`, a bare-awaited select query, and forced
  select/update errors). `fetchAllDocuments`/`fetchDocumentDetail`/
  `fetchRawText` and `enrich-job.ts`'s `new Anthropic()` are now injectable
  dependency parameters defaulting to the real implementations (rule 3),
  so no test makes a real network or Anthropic call — and no caller
  (the three `src/app/api/cron/*` routes) needed to change, since the
  injection is optional.
  **Bug found, and fixed (2026-09-09)**: none of the three jobs wrapped their
  final `finishRun(...)` call in a try/catch — if that write itself failed,
  the promise rejected with the `ingestion_runs` row stuck at
  `status: "running"` forever, which then made `startRun`'s overlap guard
  refuse every future run of that type until a human fixed the row by hand.
  Fixed with the staleness-timeout approach: `startRun` now treats a
  "running" row older than `STALE_RUN_THRESHOLD_MINUTES` (30 — see
  `constants.ts`) as abandoned, marks it `failed` as superseded, and lets the
  new run proceed — so it self-heals rows already stuck, not just future
  ones. The three jobs' `finishRun` calls were also made non-fatal
  (`finishRunSafely`, in `ingestion-run.ts`) so a failed bookkeeping write no
  longer crashes the job itself; the failure is still logged via
  `console.error` rather than swallowed silently. Covered by
  `ingestion-run.test.ts` (fresh-blocks / stale-self-heals / different-type-
  unaffected / stale-mark-failure-surfaces-loudly) and the rewritten
  ingest-job.test.ts scenario formerly named "BUG:".
- **`ingest-job.ts`/`enrich-job.ts`/`reconcile-job.ts` share a lot of
  structural duplication** (a near-identical fetch/sync/tally loop, near-
  identical result interfaces, near-identical try/catch/finishRun-on-failure
  boilerplate) that an adversarial review pass flagged and a consolidation
  would clean up. **Status: accepted for now** — deferred rather than risking
  a rushed refactor across three files right before the first real run;
  worth doing as its own follow-up once the pipeline has run live at least
  once.

## Resolved — RLS anon-read gap (was "Known blocking issue")

Discovered during an adversarial review of the Federal Register ingestion
work, pre-existing (it affected the already-built tracker page too, not
just anything new): the SELECT policies on `executive_orders`,
`ingestion_runs`, `rescinded_prior_orders`, and `agency_actions` in
`supabase/migrations/0001_init.sql` all required `auth.role() =
'authenticated'` or `is_admin()` — but Supabase Auth (Phase 5) doesn't exist
yet, so no request through the anon-key client `getSupabaseClient()` uses
could ever satisfy them. Every read through the anon client — tracker, EO
detail, Needs Attention — would have been silently RLS-denied and fallen
back to `[]` or stale local JSON, with no error surfaced anywhere.

**Decision (2026-09-07):** loosen those four tables' SELECT policies to
`using (true)` — see `supabase/migrations/0002_loosen_read_policies.sql`.
The actual security boundary today is `SITE_PASSWORD`
(`src/lib/site-auth.ts`), not per-user Supabase auth, so the
`authenticated`-only read policies were unreachable by design, not a
deliberate present-day restriction. Write policies (insert/update/delete)
are unchanged — still `is_admin()`-gated, still only reachable via the
service-role key the automated jobs use.

**Revisit at Phase 5**: once real per-user accounts ship, tighten these four
SELECT policies back (e.g. to `auth.role() = 'authenticated'` or a
role-aware policy) — `0002`'s own header comment says the same.

## Supabase project is connected (2026-09-08)

Project `tjnenceabzlvgozplpsp` ("EO Tracking Tool"). Migrations 0001-0004 are
live — verified directly against `pg_policies`/`information_schema`/
`pg_indexes`/`pg_constraint`, not just the migration-history log; that
direct verification is what caught the two issues below, which the log
alone would have missed. `NEXT_PUBLIC_SUPABASE_URL`,
`NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`, and
`CRON_SECRET` are set in `.env.local` and in Vercel
(Production/Preview/Development). `ANTHROPIC_API_KEY` and
`EO_TRACKER_MODEL` were already set in Vercel (Production/Preview only) as
of 6 days prior — not yet mirrored into local `.env.local` (Vercel won't let
a Secret-type value be read back via CLI once set; get the value again from
wherever it was originally generated if local AI content generation is
wanted).

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

**Also present, from the Supabase↔Vercel marketplace integration, and
unused by this app's code** (harmless clutter, not wired to anything):
`NEXT_PUBLIC_JCHLQSUPABASE_URL`, `NEXT_PUBLIC_JCHLQSUPABASE_ANON_KEY`,
`NEXT_PUBLIC_JCHLQSUPABASE_PUBLISHABLE_KEY`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_SECRET_KEY`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_URL`,
`SUPABASE_ANON_KEY`, `SUPABASE_JWT_SECRET`, `POSTGRES_URL`,
`POSTGRES_PRISMA_URL`, `POSTGRES_URL_NON_POOLING`, `POSTGRES_USER`,
`POSTGRES_HOST`, `POSTGRES_PASSWORD`, `POSTGRES_DATABASE` — this app only
ever reads the three `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_ANON_KEY`
/ `SUPABASE_SERVICE_ROLE_KEY` names (see `src/lib/supabase.ts`). Safe to
delete from the Vercel project if the clutter bothers you; not urgent.

## Enrichment backlog cleared (2026-09-12)

`npm run enrich:all -- --apply` summarized all 276 queued rows in 14 passes
for **$15.98**, so every one of the 614 tracker rows now has a summary. Four
things worth keeping:

- **Prompt caching works and is load-bearing.** The ~3,300-token system
  prompt is cached; every call after the first reads it at a tenth the input
  rate. `/usage` shows cache-read tokens as their own column precisely
  because the failure is silent — if that column goes to 0 during a run,
  the bill roughly doubles with nothing else looking wrong.
- **Estimating from a handful of calls is unreliable.** A mid-run estimate
  taken from the first six calls projected $8-9; the real figure was $15.98,
  because later rows produced longer outputs. Price a run from a full pass,
  or from `/usage`, not from the first few rows.
- **Resumability earned its keep.** One row failed with a Gateway Timeout
  mid-run; because each pass selects only rows where `ai_summary IS NULL`, a
  later pass picked it up with no intervention. Interrupting `enrich:all` at
  any point is safe.
- **Two rows were flagged** by quote verification and left unsummarized-but-
  flagged rather than saved — see `/needs-attention`.

Outcome against the firm's own corpus: median 83 words (the firm's
hand-written median is 67), zero multi-paragraph summaries, 0% empty subject
areas. But practice areas came back empty on 54% of rows and industries on
66%, which makes the drafted practice-area `criteria` unproven — see the
ledger row about reviewing them.

## Summary quality audit (2026-09-12)

`verify-facts.ts` checks the hard facts in every summary — deadlines, money,
percentages, statutory citations, instrument numbers, dates — against that
row's `full_text`. Run over all 498 summarized rows with source text, it
found **759 checkable facts** and, after the checker's own false positives
were fixed, **4 flags**:

- **Zero confirmed fabrications in the 276 AI-written summaries.** Every
  flag traced to the checker's formatting assumptions, not the model.
- **One genuine defect, and it is the firm's own**: `EO 14183`
  ("Prioritizing Military Excellence and Readiness") carries a legacy
  hand-written summary describing a Unified Command Plan revision with a
  10-day deadline. That order's text contains neither. The summary appears
  to belong to a different document; it came from the source spreadsheet,
  not from any AI run. Worth correcting by hand.

The audit's own first pass flagged 19 rows; 15 of those were the checker
being wrong, and fixing them is most of what `verify-facts.ts` now does:
sources spell deadlines out ("within sixty days"), write ".15 percent"
without the leading zero, write "$125,000,000" where a summary writes
"$125 million", and cite statutes as "section 551(4), title 5, United
States Code" where a summary correctly reformats to "5 U.S.C. 551(4)".
Each of those is a regression test now. **Read a flag as "look at this",
never as "this is wrong"** — and note the check only asks whether a figure
appears in the source at all, not whether it is attached to the right actor
or provision.

## Manual-steps ledger

Steps that need a human, can't be automated away, and how to tell they're done:

| Step | Where | Done when |
|---|---|---|
| Run `npm run import:supabase` once (loads the 340 legacy rows) — **not safe to re-run**, only after confirming the tables are empty | local machine, after `.env.local` has real Supabase keys | Rows visible in Supabase's Table Editor |
| Run `npm run backfill:federal-register` once, after `import:supabase` | local machine | `/needs-attention` shows recent runs and the tracker's order count jumps to match the administration-to-date total |
| Set `AI_GATEWAY_API_KEY` (from Vercel > AI Gateway > API Keys) in `.env.local` and in Vercel, to route Claude calls through the gateway instead of the Anthropic API directly | Vercel dashboard / `vercel env add` | An enrichment run logs "Vercel AI Gateway"; requests appear in the AI Gateway overview |
| **Top up Anthropic credits before the next large run.** The 276-row enrichment on 2026-09-12 cost $15.98 of a $20.00 balance, leaving roughly $4. A full `draft:summaries` pass costs about the same again and will stop partway on insufficient credit (safely — it resumes) | Anthropic Console | `/usage` totals plus the Console balance agree, with headroom |
| Set a monthly spending cap — on the AI Gateway budget if routing through it, otherwise on the Anthropic API key | Vercel AI Gateway settings / Anthropic Console | Cap visible in that product's billing limits page |
| Review the derived summarization prompt at `/prompt` and the drafted practice-area `criteria` in `src/config/practice-areas.json` — both are a first pass distilled from the firm's own summaries, not firm-authored | the app / editor | You've read them once and edited or accepted them |
| Run `npm run draft:summaries -- --apply --limit N` in batches against the 222 curated rows that have full text, then compare on each EO page. Watch `/usage` between batches — see the credit row above | local machine | Drafts visible beneath the curated summaries |
| Set `SITE_PASSWORD` if sharing a deployed URL pre-auth | deployment env vars | `/gate` prompts before the app loads |

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
