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
- **The three Federal Register job orchestration functions** (`ingest-job.ts`,
  `enrich-job.ts`, `reconcile-job.ts`) are not integration-tested end to end —
  doing so would mean mocking both the Federal Register API and Supabase
  together, which is a lot of test-infrastructure weight for what's mostly
  wiring. What each depends on **is** tested directly: `sync.ts` (the actual
  insert/update/flag decisions, via `test-support/fake-supabase.ts`),
  `clean-text.ts`, `parse-disposition.ts`, `quote-verify.ts`, `cron-auth.ts`,
  and `summarize.ts`'s response validation, all against real captured API
  samples (`fixtures/`). **Status: accepted for now** — revisit if a bug ever
  turns up in the orchestration layer itself rather than in one of the
  pieces it calls. `ingestion-run.ts`'s overlap guard is one specific piece
  of that untested orchestration layer worth calling out — it's the thing
  that prevents two overlapping cron invocations, and a regression there
  wouldn't be caught by anything currently in the suite.
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

Project `tjnenceabzlvgozplpsp` ("EO Tracking Tool"). Both migrations are live
(verified directly against `pg_policies`, not just the migration-history
log). `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY`, and `CRON_SECRET` are set in `.env.local` and in
Vercel (Production/Preview/Development). `ANTHROPIC_API_KEY` and
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

## Manual-steps ledger

Steps that need a human, can't be automated away, and how to tell they're done:

| Step | Where | Done when |
|---|---|---|
| Run `npm run import:supabase` once (loads the 340 legacy rows) — **not safe to re-run**, only after confirming the tables are empty | local machine, after `.env.local` has real Supabase keys | Rows visible in Supabase's Table Editor |
| Run `npm run backfill:federal-register` once, after `import:supabase` | local machine | `/needs-attention` shows recent runs and the tracker's order count jumps to match the administration-to-date total |
| Set a monthly spending cap on the Anthropic API key | Anthropic Console | Cap visible in the Console's billing limits page |
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
