// The current administration's first day — the fixed lower bound for both
// the one-time historical backfill and reconciliation's full-range check.
export const ADMINISTRATION_START_DATE = "2025-01-20";

// Trailing window the daily ingest job re-checks. Covers the worst
// signing-to-publication lag observed (56 days) with margin — see the
// Federal Register API research this was based on.
export const INGEST_TRAILING_WINDOW_DAYS = 90;

// How many null-ai_summary rows the enrich job processes per run —
// deliberately conservative so a large post-backfill backlog clears
// gradually rather than risking a cost spike against the Anthropic
// spending cap.
export const ENRICH_BATCH_SIZE = 20;

// How long an ingestion_runs row can sit at status "running" before
// startRun's overlap guard stops treating it as genuinely in-flight and
// self-heals it (marks it "failed" as superseded-by-stale, then proceeds
// with the new run) instead of refusing every future run of that type
// forever. All three cron jobs run as ordinary Vercel serverless functions,
// which enforce a hard per-invocation execution cap — see
// scripts/backfill-federal-register.ts's header comment, which deliberately
// keeps the historical backfill as a local script instead of a cron
// endpoint specifically because it can exceed that cap. 30 minutes is
// several times longer than any of these three jobs could legitimately
// still be running (the platform would have killed the invocation first),
// so it never mistakes a real in-progress run for an abandoned one, while
// still being short enough that a genuinely stuck row self-heals well
// within the same day rather than requiring a human to fix it by hand.
export const STALE_RUN_THRESHOLD_MINUTES = 30;
