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

## Known blocking issue — RLS will silently break every anon-client read

Discovered during an adversarial review of the Federal Register ingestion
work, and **pre-existing** (not introduced by that work — it affects the
already-built tracker page too, not just anything new):

`executive_orders`' and `ingestion_runs`' SELECT policies in
`supabase/migrations/0001_init.sql` require `auth.role() = 'authenticated'`
(or `is_admin()`) — but Supabase Auth (Phase 5) doesn't exist yet, so
**there is currently no way for the anon-key client `getSupabaseClient()`
uses to ever satisfy either policy.** Once Supabase is actually connected,
every read through the anon client — the tracker page, the EO detail page,
and the new Needs Attention page — will be silently RLS-denied and fall back
to `[]` or stale local JSON, with no error surfaced anywhere. The only
client that bypasses RLS today is the service-role client the ingestion jobs
use — which means ingestion would appear to work (writes succeed via
service-role) while every page reading that data through the anon client
shows nothing or stale data.

This needs a decision, not a fix Claude should make unilaterally: it changes
a documented security boundary. The two live options —

1. **Loosen the affected SELECT policies to `using (true)`** for the current
   phase (matching the fact that the *actual* current security boundary is
   `SITE_PASSWORD`, not per-user Supabase auth — RLS' `authenticated`-only
   read policies are currently unreachable by design, not a deliberate
   present-day restriction), tightening them again once Phase 5 ships real
   accounts.
2. **Have reads go through the service-role client too**, at least for
   server-only pages like `/needs-attention` — defers the RLS question
   entirely until Phase 5, but stretches "service-role" further than its
   stated purpose ("automated jobs only").

Confirm this is understood and resolved (either option, or another) **before
connecting Supabase to a live project** — otherwise the very first thing
that happens is the app looking broken with no error message explaining why.

## Manual-steps ledger

Steps that need a human, can't be automated away, and how to tell they're done:

| Step | Where | Done when |
|---|---|---|
| Create Supabase project + run `supabase/migrations/0001_init.sql` | supabase.com SQL Editor | Tables visible in Supabase's Table Editor |
| Paste Supabase URL/anon key/service role key into `.env.local` | local machine, per developer | `isUsingLocalData()` in `src/lib/data.ts` returns `false` |
| Set `ANTHROPIC_API_KEY` (+ optional `EO_TRACKER_MODEL`) | `.env.local` / deployment env | Content drafts stop being stub text |
| Set a monthly spending cap on the Anthropic API key | Anthropic Console | Cap visible in the Console's billing limits page |
| Set `SITE_PASSWORD` if sharing a deployed URL pre-auth | deployment env vars | `/gate` prompts before the app loads |
| Generate and set `CRON_SECRET` (`openssl rand -hex 32`) | `.env.local` + Vercel project env vars | `/api/cron/*` returns 401 without it, 200 with the matching Bearer token |
| Run `npm run backfill:federal-register` once, after Supabase is connected | local machine | `/needs-attention` shows recent runs and the tracker's order count jumps to match the administration-to-date total |

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
