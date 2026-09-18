import type { RunType } from "@/lib/federal-register/ingestion-run";

const HOURS_PER_DAY = 24;

/**
 * How stale each job's most recent run may be before the watchdog calls it
 * missing.
 *
 * These are derived from the cron schedules in vercel.json, and are not
 * free-floating numbers — changing a schedule there without changing the
 * matching value here either produces a recurring false alarm or blinds the
 * check. The watchdog itself runs at 12:00 UTC, after all three.
 *
 *   ingest     10:00 UTC daily   -> ~2h old at watchdog time when healthy
 *   enrich     10:30 UTC daily   -> ~1.5h old at watchdog time when healthy
 *   reconcile  11:00 UTC Mondays -> ~1h old on Monday, ~145h by Sunday
 *
 * The daily allowance is deliberately far below the 26h a skipped run
 * shows, rather than just below it. Vercel invokes a cron within its
 * scheduled hour rather than exactly on the minute, and lateness works
 * against detection: if yesterday's run started an hour late and today's
 * never fires at all, the observed age is 25h, not 26h. A tight 25h
 * allowance therefore misses that case entirely. 20h has ~17h of headroom
 * before a healthy run could trip it and ~6h of margin for catching a
 * skipped one — wrong in neither direction under any plausible delay.
 *
 * The weekly allowance is the opposite trade. Exactly 7 days (168h) would
 * catch a missed Monday on the Monday itself, but would also false-alarm
 * whenever reconcile slipped past 12:00 on an otherwise healthy week. A
 * false alarm is worse than a day's delay for a weekly job, so this allows
 * a week plus two hours and catches a missed Monday on the Tuesday.
 */
export const MAX_RUN_AGE_HOURS: Record<RunType, number> = {
  federal_register: 20,
  federal_register_enrichment: 20,
  federal_register_reconciliation: 7 * HOURS_PER_DAY + 2,
};

// Note: ingestion_runs' own check constraint (migration 0001) also permits
// 'litigation_news' and 'digest_email', for work that isn't built. RunType
// deliberately doesn't model those two, so they cannot reach this table —
// and a Record<RunType, number> means adding a fourth scheduled job fails
// to compile until its allowance is set here, rather than being silently
// skipped by the watchdog.

// The job types the watchdog expects to see run, derived from the table
// above so the two can never disagree.
export const WATCHED_RUN_TYPES = Object.keys(MAX_RUN_AGE_HOURS) as RunType[];

// The weekday (UTC, 0 = Sunday) on which the watchdog reports in even when
// everything is healthy. Silence is ambiguous — it could mean "nothing is
// wrong" or "the watchdog is dead" — so one scheduled all-clear a week is
// what makes the other six days' silence trustworthy.
export const ALL_CLEAR_WEEKDAY_UTC = 1;
