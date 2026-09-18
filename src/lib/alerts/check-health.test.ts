import { describe, expect, it } from "vitest";
import { checkHealth, type RunSummary } from "@/lib/alerts/check-health";

// A Thursday, two hours after the ingest cron — so no all-clear is due.
const NOW = new Date("2026-09-17T12:00:00Z");
// The Monday after, when the all-clear is due.
const ALL_CLEAR_DAY = new Date("2026-09-21T12:00:00Z");

function run(overrides: Partial<RunSummary> = {}): RunSummary {
  return {
    runType: "federal_register",
    status: "success",
    startedAt: "2026-09-17T10:00:00Z",
    newCount: 0,
    updatedCount: 0,
    errorMessage: null,
    ...overrides,
  };
}

const MS_PER_HOUR = 3_600_000;

function hoursBefore(reference: Date, hours: number): string {
  return new Date(reference.getTime() - hours * MS_PER_HOUR).toISOString();
}

/**
 * All three jobs ran on schedule, all succeeded — expressed relative to
 * `reference` rather than as fixed dates, so a test that moves `now` (the
 * all-clear day, a missed weekly slot) doesn't accidentally make every
 * daily job look stale as well and pass for the wrong reason.
 */
function healthyRuns(reference: Date = NOW): RunSummary[] {
  return [
    run({ runType: "federal_register", startedAt: hoursBefore(reference, 2) }),
    run({ runType: "federal_register_enrichment", startedAt: hoursBefore(reference, 1.5), updatedCount: 3 }),
    run({ runType: "federal_register_reconciliation", startedAt: hoursBefore(reference, 72) }),
  ];
}

function without(runType: RunSummary["runType"], reference: Date = NOW): RunSummary[] {
  return healthyRuns(reference).filter((r) => r.runType !== runType);
}

describe("checkHealth", () => {
  it("stays silent when every job ran on schedule and it is not the all-clear day", () => {
    const report = checkHealth({ now: NOW, runs: healthyRuns(), enrichQueueDepth: 0 });
    expect(report.problems).toEqual([]);
    expect(report.shouldStaySilent).toBe(true);
    expect(report.isAllClearDay).toBe(false);
  });

  it("speaks up on the all-clear day even with nothing wrong", () => {
    const report = checkHealth({ now: ALL_CLEAR_DAY, runs: healthyRuns(ALL_CLEAR_DAY), enrichQueueDepth: 0 });
    expect(report.problems).toEqual([]);
    expect(report.isAllClearDay).toBe(true);
    expect(report.shouldStaySilent).toBe(false);
  });

  describe("a run that never happened", () => {
    it("reports a daily job that has not run for over a day", () => {
      // The case nothing inside a job can report: all three orchestrators
      // call startRun() before their try block, so a job that dies earlier
      // leaves no row, and a cron that never fires leaves no trace at all.
      const runs = without("federal_register");
      runs.push(run({ runType: "federal_register", startedAt: "2026-09-16T10:00:00Z" }));

      const report = checkHealth({ now: NOW, runs, enrichQueueDepth: 0 });

      expect(report.problems).toHaveLength(1);
      expect(report.problems[0].kind).toBe("missing_run");
      expect(report.problems[0].runType).toBe("federal_register");
      expect(report.problems[0].headline).toContain("has not run since");
    });

    it("accepts a weekly reconcile that ran three days ago", () => {
      // Guards against the obvious mistake of applying the daily allowance
      // to the weekly job, which would alert six days in seven.
      const problems = checkHealth({ now: NOW, runs: healthyRuns(), enrichQueueDepth: 0 }).problems;
      expect(problems.filter((p) => p.runType === "federal_register_reconciliation")).toEqual([]);
    });

    it("reports a weekly reconcile that missed its slot, the day after it should have run", () => {
      // The Tuesday after a missed Monday: 8 days and an hour since the
      // last one, so it is caught then rather than a full week later. The
      // daily jobs are kept healthy relative to that Tuesday so this
      // asserts the weekly allowance specifically.
      const tuesday = new Date("2026-09-22T12:00:00Z");
      const runs = without("federal_register_reconciliation", tuesday);
      runs.push(run({ runType: "federal_register_reconciliation", startedAt: hoursBefore(tuesday, 8 * 24 + 1) }));

      const report = checkHealth({ now: tuesday, runs, enrichQueueDepth: 0 });

      expect(report.problems.filter((p) => p.kind !== "missing_run")).toEqual([]);
      const reconcileProblems = report.problems.filter(
        (p) => p.runType === "federal_register_reconciliation" && p.kind === "missing_run",
      );
      expect(reconcileProblems).toHaveLength(1);
    });

    it("reports a job type that has never run at all", () => {
      const report = checkHealth({
        now: NOW,
        runs: without("federal_register_enrichment"),
        enrichQueueDepth: 0,
      });
      const problem = report.problems.find((p) => p.runType === "federal_register_enrichment");
      expect(problem?.headline).toContain("has never run");
    });
  });

  describe("a run that finished badly", () => {
    it("reports the newest run having failed, with its error message", () => {
      const runs = without("federal_register_enrichment");
      runs.push(
        run({
          runType: "federal_register_enrichment",
          status: "failure",
          startedAt: hoursBefore(NOW, 1.5),
          errorMessage: "No AI credentials configured",
        }),
      );

      const report = checkHealth({ now: NOW, runs, enrichQueueDepth: 0 });

      const bad = report.problems.find((p) => p.kind === "bad_run");
      expect(bad?.headline).toContain("recorded failure");
      expect(bad?.detail).toContain("No AI credentials configured");
    });

    it("reports a partial run too", () => {
      const runs = without("federal_register");
      runs.push(run({ status: "partial", startedAt: hoursBefore(NOW, 2), errorMessage: "one document failed" }));
      const report = checkHealth({ now: NOW, runs, enrichQueueDepth: 0 });
      expect(report.problems.some((p) => p.kind === "bad_run")).toBe(true);
    });

    it("does not re-report a failure a later run already recovered from", () => {
      // Only the newest run of a type is judged. A failure at 10:00 that a
      // manual re-run fixed at 11:00 is not a live problem, and saying so
      // every day would be exactly the noise that gets an alert muted.
      const runs = without("federal_register");
      runs.push(run({ status: "failure", startedAt: hoursBefore(NOW, 3), errorMessage: "transient" }));
      runs.push(run({ status: "success", startedAt: hoursBefore(NOW, 2) }));

      expect(checkHealth({ now: NOW, runs, enrichQueueDepth: 0 }).problems).toEqual([]);
    });

    it("reports only once per job type, never twice for one cause", () => {
      const runs = without("federal_register");
      runs.push(run({ status: "failure", startedAt: hoursBefore(NOW, 2), errorMessage: "boom" }));
      const report = checkHealth({ now: NOW, runs, enrichQueueDepth: 0 });
      expect(report.problems.filter((p) => p.runType === "federal_register")).toHaveLength(1);
    });
  });

  describe("a run stuck mid-flight", () => {
    it("leaves a genuinely in-progress run alone", () => {
      const runs = without("federal_register");
      runs.push(run({ status: "running", startedAt: hoursBefore(NOW, 0.05) }));
      expect(checkHealth({ now: NOW, runs, enrichQueueDepth: 0 }).problems).toEqual([]);
    });

    it("reports a run left at running for longer than any run can legitimately take", () => {
      // A platform timeout after startRun leaves a row that finishRun never
      // completes. It is the newest row of its type and only hours old, so
      // without this check it satisfies the staleness test and is skipped by
      // the status test — and a job dying at the function time limit every
      // night reads as a healthy pipeline forever.
      const runs = without("federal_register");
      runs.push(run({ status: "running", startedAt: hoursBefore(NOW, 2) }));

      const report = checkHealth({ now: NOW, runs, enrichQueueDepth: 0 });

      expect(report.problems).toHaveLength(1);
      expect(report.problems[0].kind).toBe("stuck_run");
      expect(report.problems[0].headline).toContain("stuck mid-run");
    });
  });

  describe("the staleness allowance has margin in both directions", () => {
    it("does not alert on a healthy daily run that started several hours late", () => {
      const runs = without("federal_register");
      runs.push(run({ startedAt: hoursBefore(NOW, 8) }));
      expect(checkHealth({ now: NOW, runs, enrichQueueDepth: 0 }).problems).toEqual([]);
    });

    it("still catches a skipped day when the previous run was itself an hour late", () => {
      // The case a tight 25h allowance misses: lateness works against
      // detection, because a late previous run makes the observed gap
      // smaller than the nominal 26h.
      const runs = without("federal_register");
      runs.push(run({ startedAt: hoursBefore(NOW, 25) }));

      const report = checkHealth({ now: NOW, runs, enrichQueueDepth: 0 });

      expect(report.problems.filter((p) => p.kind === "missing_run")).toHaveLength(1);
    });
  });

  describe("enrichment that ran but got nowhere", () => {
    /** Two enrichment runs on consecutive nights, each moving `moved` rows. */
    function enrichRuns(moved: [number, number]): RunSummary[] {
      const runs = without("federal_register_enrichment");
      runs.push(
        run({ runType: "federal_register_enrichment", startedAt: hoursBefore(NOW, 1.5), updatedCount: moved[0] }),
        run({ runType: "federal_register_enrichment", startedAt: hoursBefore(NOW, 25.5), updatedCount: moved[1] }),
      );
      return runs;
    }

    it("reports rows queued while the last two runs summarized none", () => {
      // The gap this check exists for. A run that had work waiting and
      // moved none of it is broken whatever status it recorded — including
      // the case where every summary was flagged for an unverifiable
      // quote, which records success.
      const report = checkHealth({ now: NOW, runs: enrichRuns([0, 0]), enrichQueueDepth: 12 });

      const stalled = report.problems.find((p) => p.kind === "enrichment_stalled");
      expect(stalled?.headline).toContain("12 rows are waiting");
    });

    it("tolerates a single run that moved nothing, because that is an ordinary race", () => {
      // Ingest and enrich are half an hour apart but Vercel does not
      // guarantee their order within the hour, so enrich can legitimately
      // run against an empty queue moments before ingest inserts a
      // document. Alerting on one such run would cry wolf on a healthy
      // pipeline, and the next night picks the row up normally.
      const report = checkHealth({ now: NOW, runs: enrichRuns([0, 5]), enrichQueueDepth: 1 });
      expect(report.problems).toEqual([]);
    });

    it("stays quiet when the queue is empty, however little the runs did", () => {
      // A nightly run with nothing queued makes no model call at all, so
      // there is nothing to conclude from it either way. Saying so would be
      // a nightly false alarm — and this is the project's state today.
      const report = checkHealth({ now: NOW, runs: enrichRuns([0, 0]), enrichQueueDepth: 0 });
      expect(report.problems).toEqual([]);
    });

    it("does not report stalling on top of a failure with the same cause", () => {
      // One cause must not produce two messages. Reporting the same broken
      // credential as both a failed run and a stalled queue trains the
      // reader to skim, which is what makes an alerting system useless.
      const runs = enrichRuns([0, 0]);
      runs[runs.length - 2] = run({
        runType: "federal_register_enrichment",
        status: "failure",
        startedAt: hoursBefore(NOW, 1.5),
        updatedCount: 0,
        errorMessage: "No AI credentials configured",
      });

      const report = checkHealth({ now: NOW, runs, enrichQueueDepth: 12 });

      expect(report.problems.filter((p) => p.kind === "enrichment_stalled")).toEqual([]);
      expect(report.problems.filter((p) => p.kind === "bad_run")).toHaveLength(1);
    });
  });
});
