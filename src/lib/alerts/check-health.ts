import { STALE_RUN_THRESHOLD_MINUTES } from "@/lib/federal-register/constants";
import type { RunStatus, RunType } from "@/lib/federal-register/ingestion-run";
import { ALL_CLEAR_WEEKDAY_UTC, MAX_RUN_AGE_HOURS, WATCHED_RUN_TYPES } from "@/lib/alerts/thresholds";

const MS_PER_HOUR = 3_600_000;
const MINUTES_PER_HOUR = 60;

export interface RunSummary {
  runType: RunType;
  status: RunStatus | "running";
  startedAt: string;
  newCount: number;
  updatedCount: number;
  errorMessage: string | null;
}

export interface HealthInput {
  now: Date;
  /** Recent runs, any order — this module sorts what it needs. */
  runs: RunSummary[];
  /** Rows waiting to be summarized: ai_summary null, full_text present. */
  enrichQueueDepth: number;
}

export type ProblemKind = "missing_run" | "bad_run" | "stuck_run" | "enrichment_stalled";

export interface Problem {
  kind: ProblemKind;
  runType?: RunType;
  headline: string;
  detail: string;
}

export interface HealthReport {
  problems: Problem[];
  /** True on the day the watchdog reports in even when healthy. */
  isAllClearDay: boolean;
  /** Nothing wrong and nothing to say — the watchdog stays quiet. */
  shouldStaySilent: boolean;
}

function hoursBetween(later: Date, earlier: Date): number {
  return (later.getTime() - earlier.getTime()) / MS_PER_HOUR;
}

function describeAge(hours: number): string {
  if (hours < 48) return `${Math.floor(hours)}h ago`;
  return `${Math.floor(hours / 24)} days ago`;
}

/** Runs of one type, newest first. */
function runsOfType(runs: RunSummary[], runType: RunType): RunSummary[] {
  return runs
    .filter((run) => run.runType === runType)
    .sort((a, b) => new Date(b.startedAt).getTime() - new Date(a.startedAt).getTime());
}

/**
 * Decides what one job type's most recent run says about it, or undefined if
 * it says nothing wrong.
 *
 * Deliberately at most one problem per job type. Looking only at the newest
 * run means a failure that a later run already recovered from is not
 * re-reported, a failure that persists is reported every day (correct), and
 * one root cause can never produce two messages — which is the thing most
 * likely to train the reader to skim.
 */
function checkRunType(runs: RunSummary[], runType: RunType, now: Date): Problem | undefined {
  const history = runsOfType(runs, runType);
  const newest = history[0];

  if (!newest) {
    return {
      kind: "missing_run",
      runType,
      headline: `${runType} has never run`,
      detail: "No run of this type has ever been recorded. Check that the cron is scheduled and deployed.",
    };
  }

  const ageHours = hoursBetween(now, new Date(newest.startedAt));

  if (newest.status === "running") {
    // A platform timeout after startRun leaves a row at "running" that
    // finishRun never completes — ingestion-run.ts documents this as
    // reachable. Such a row is the newest of its type and only a couple of
    // hours old, so without this branch it would satisfy the staleness
    // check and be skipped by the status check, and a job dying at the
    // function time limit every single night would read as a healthy
    // pipeline indefinitely.
    if (ageHours * MINUTES_PER_HOUR > STALE_RUN_THRESHOLD_MINUTES) {
      return {
        kind: "stuck_run",
        runType,
        headline: `${runType} has been stuck mid-run since ${describeAge(ageHours)}`,
        detail:
          `Started ${newest.startedAt} and never recorded an outcome, which is longer than any run of this ` +
          `type can legitimately take (${STALE_RUN_THRESHOLD_MINUTES} minutes). Most likely the invocation hit ` +
          "the platform's execution limit. The next run self-heals the row but will hit the same wall.",
      };
    }
    return undefined; // genuinely in flight
  }

  if (ageHours > MAX_RUN_AGE_HOURS[runType]) {
    return {
      kind: "missing_run",
      runType,
      headline: `${runType} has not run since ${describeAge(ageHours)}`,
      detail:
        `Expected a run within ${MAX_RUN_AGE_HOURS[runType]}h; the newest started ${newest.startedAt} ` +
        `and recorded ${newest.status}. ${newest.errorMessage ?? ""}`.trim() +
        " Either the cron did not fire, or the job failed before it could record anything.",
    };
  }

  if (newest.status === "failure" || newest.status === "partial") {
    return {
      kind: "bad_run",
      runType,
      headline: `${runType} recorded ${newest.status}`,
      detail: `Started ${newest.startedAt}. ${newest.errorMessage ?? "No error message was recorded."}`,
    };
  }

  return undefined;
}

/**
 * Decides what is wrong with the pipeline, from a snapshot of its recent
 * runs. Deliberately pure — it takes data and returns findings, touching no
 * database and no network (rule 3), because the conditions it encodes are
 * the part most worth testing and the part hardest to exercise against a
 * live system: you cannot make production skip a night to order.
 *
 * Two families of check:
 *
 * 1. Per job type, what its newest run says — never ran, missing, stuck
 *    mid-run, or finished badly. Nothing inside a job can report the first
 *    three: all three orchestrators call startRun() before their try block,
 *    so a job that dies earlier leaves no row at all, and a cron that never
 *    fires leaves no trace anywhere. Absence is only visible from outside.
 *
 * 2. Enrichment that ran but got nowhere. This one exists because an empty
 *    queue means a nightly enrich run makes no model call at all, so its
 *    `success` proves the job ran and nothing about whether the Anthropic
 *    credential still works.
 */
export function checkHealth({ now, runs, enrichQueueDepth }: HealthInput): HealthReport {
  const problems: Problem[] = [];

  for (const runType of WATCHED_RUN_TYPES) {
    const problem = checkRunType(runs, runType, now);
    if (problem) problems.push(problem);
  }

  const enrichAlreadyReported = problems.some((p) => p.runType === "federal_register_enrichment");
  const recentEnrich = runsOfType(runs, "federal_register_enrichment");
  const [newestEnrich, previousEnrich] = recentEnrich;

  // Two consecutive runs that moved nothing, not one. A single zero-progress
  // run is expected and harmless: ingest and enrich are half an hour apart
  // but Vercel does not guarantee their order within the hour, so enrich can
  // legitimately run against an empty queue moments before ingest inserts a
  // document — which the next night picks up normally. Alerting on one run
  // would fire on that ordinary race, and an alert that cries wolf on a
  // healthy pipeline is worse than no alert at all. Requiring two costs a
  // day's detection delay on a genuine stall and buys immunity from the
  // whole false-alarm class.
  const stalledTwice =
    newestEnrich !== undefined &&
    previousEnrich !== undefined &&
    newestEnrich.updatedCount === 0 &&
    previousEnrich.updatedCount === 0;

  if (enrichQueueDepth > 0 && stalledTwice && !enrichAlreadyReported) {
    problems.push({
      kind: "enrichment_stalled",
      runType: "federal_register_enrichment",
      headline: `${enrichQueueDepth} rows are waiting to be summarized and the last two runs summarized none`,
      detail:
        `The two most recent enrichment runs (${newestEnrich.startedAt}, ${previousEnrich.startedAt}) both ` +
        "recorded no updates while work was queued. Likely causes: the Anthropic credential is empty or " +
        "rejected, or every summary is being flagged for an unverifiable quote — a flagged row keeps " +
        "ai_summary null, so it stays in this queue and is retried, and paid for, every night.",
    });
  }

  const isAllClearDay = now.getUTCDay() === ALL_CLEAR_WEEKDAY_UTC;
  return { problems, isAllClearDay, shouldStaySilent: problems.length === 0 && !isAllClearDay };
}
