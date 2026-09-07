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
