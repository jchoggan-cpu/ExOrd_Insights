import { describe, expect, it } from "vitest";
import { STALE_RUN_THRESHOLD_MINUTES } from "@/lib/federal-register/constants";
import { finishRun, startRun } from "@/lib/federal-register/ingestion-run";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

const MS_PER_MINUTE = 60_000;
function minutesAgoIso(minutes: number): string {
  return new Date(Date.now() - minutes * MS_PER_MINUTE).toISOString();
}

// This is the piece CLAUDE.md calls out by name: the overlap guard that
// stops two concurrent cron invocations of the same job from running at
// once. A regression here (e.g. the check query no longer actually gating
// the insert) wouldn't be caught by anything else in the suite.
describe("startRun overlap guard", () => {
  it("starts a run and records it as running when nothing else is in progress", async () => {
    const supabase = createFakeSupabase({});

    const runId = await startRun(supabase, "federal_register");

    expect(typeof runId).toBe("string");
    expect(supabase.ingestionRuns).toHaveLength(1);
    expect(supabase.ingestionRuns[0]).toMatchObject({
      id: runId,
      run_type: "federal_register",
      status: "running",
    });
  });

  it("refuses a second run of the same type while one is already running and still fresh", async () => {
    const supabase = createFakeSupabase({
      ingestionRuns: [
        { id: "run-in-flight", run_type: "federal_register", status: "running", started_at: minutesAgoIso(1) },
      ],
    });

    await expect(startRun(supabase, "federal_register")).rejects.toThrow(/already in progress/);
    // The guard must refuse before inserting a second row, and must not
    // have touched the still-fresh row it refused on top of.
    expect(supabase.ingestionRuns).toHaveLength(1);
    expect(supabase.ingestionRuns[0].status).toBe("running");
  });

  it("does not block a run of a different type while one type is running", async () => {
    const supabase = createFakeSupabase({
      ingestionRuns: [
        { id: "run-in-flight", run_type: "federal_register", status: "running", started_at: minutesAgoIso(1) },
      ],
    });

    const runId = await startRun(supabase, "federal_register_enrichment");

    expect(typeof runId).toBe("string");
    expect(supabase.ingestionRuns).toHaveLength(2);
    // The other type's fresh running row is untouched either way.
    expect(supabase.ingestionRuns[0]).toMatchObject({ run_type: "federal_register", status: "running" });
  });

  it("does not block, and self-heals, a running row older than the staleness threshold", async () => {
    const staleStartedAt = minutesAgoIso(STALE_RUN_THRESHOLD_MINUTES + 1);
    const supabase = createFakeSupabase({
      ingestionRuns: [
        { id: "abandoned-run", run_type: "federal_register", status: "running", started_at: staleStartedAt },
      ],
    });

    const runId = await startRun(supabase, "federal_register");

    expect(typeof runId).toBe("string");
    expect(runId).not.toBe("abandoned-run");
    expect(supabase.ingestionRuns).toHaveLength(2);

    // The abandoned row is marked failed as superseded, not left "running" —
    // so it stops jamming this guard (and the Needs Attention report) forever.
    expect(supabase.ingestionRuns[0]).toMatchObject({ id: "abandoned-run", status: "failure" });
    expect(supabase.ingestionRuns[0].error_message).toMatch(/stale/i);
    expect(typeof supabase.ingestionRuns[0].finished_at).toBe("string");

    // The new run actually starts.
    expect(supabase.ingestionRuns[1]).toMatchObject({ id: runId, run_type: "federal_register", status: "running" });
  });

  it("does not treat a running row right at the threshold boundary as stale", async () => {
    // Slightly younger than the threshold — still fresh, must still block.
    const supabase = createFakeSupabase({
      ingestionRuns: [
        {
          id: "run-in-flight",
          run_type: "federal_register",
          status: "running",
          started_at: minutesAgoIso(STALE_RUN_THRESHOLD_MINUTES - 1),
        },
      ],
    });

    await expect(startRun(supabase, "federal_register")).rejects.toThrow(/already in progress/);
    expect(supabase.ingestionRuns).toHaveLength(1);
  });

  it("surfaces a failure to mark a stale run as superseded, rather than silently starting a new run anyway", async () => {
    const staleStartedAt = minutesAgoIso(STALE_RUN_THRESHOLD_MINUTES + 1);
    const supabase = createFakeSupabase({
      ingestionRuns: [
        { id: "abandoned-run", run_type: "federal_register", status: "running", started_at: staleStartedAt },
      ],
      failUpdate: { ingestion_runs: "network blip" },
    });

    await expect(startRun(supabase, "federal_register")).rejects.toThrow(/failed to mark it superseded/i);
    // Refuses to compound the problem by starting a second run on top of an
    // overlap guard it couldn't actually clear.
    expect(supabase.ingestionRuns).toHaveLength(1);
    expect(supabase.ingestionRuns[0].status).toBe("running");
  });

  it("surfaces a failed overlap check rather than silently starting a second run", async () => {
    const supabase = createFakeSupabase({ failSelect: { ingestion_runs: "connection lost" } });

    await expect(startRun(supabase, "federal_register")).rejects.toThrow(/connection lost/);
    expect(supabase.ingestionRuns).toHaveLength(0);
  });

  it("releases the guard on the success path — finishRun lets a later run start", async () => {
    const supabase = createFakeSupabase({});

    const firstRunId = await startRun(supabase, "federal_register");
    await finishRun(supabase, firstRunId, { status: "success", newCount: 3, updatedCount: 1 });

    expect(supabase.ingestionRuns[0]).toMatchObject({
      status: "success",
      new_count: 3,
      updated_count: 1,
      error_message: null,
    });
    expect(typeof supabase.ingestionRuns[0].finished_at).toBe("string");

    const secondRunId = await startRun(supabase, "federal_register");
    expect(secondRunId).not.toBe(firstRunId);
    expect(supabase.ingestionRuns).toHaveLength(2);
  });

  it("releases the guard on the failure path — a failed run does not block the next one", async () => {
    const supabase = createFakeSupabase({});

    const firstRunId = await startRun(supabase, "federal_register");
    await finishRun(supabase, firstRunId, {
      status: "failure",
      newCount: 0,
      updatedCount: 0,
      errorMessage: "list request failed",
    });

    expect(supabase.ingestionRuns[0]).toMatchObject({
      status: "failure",
      error_message: "list request failed",
    });

    const secondRunId = await startRun(supabase, "federal_register");
    expect(secondRunId).not.toBe(firstRunId);
    expect(supabase.ingestionRuns).toHaveLength(2);
  });
});
