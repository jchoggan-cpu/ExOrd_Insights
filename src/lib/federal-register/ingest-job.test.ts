import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { STALE_RUN_THRESHOLD_MINUTES } from "@/lib/federal-register/constants";
import { runIngestJob } from "@/lib/federal-register/ingest-job";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

const MS_PER_MINUTE = 60_000;

const FIXTURE_DIR = join(__dirname, "fixtures");

function loadDoc(name: string): FederalRegisterDocument {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8"));
}

function loadRawText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

describe("runIngestJob", () => {
  it("happy path: fetches, ingests every document, and records success on ingestion_runs", async () => {
    const supabase = createFakeSupabase({});
    const doc = loadDoc("eo-14421-detail.json");
    const rawText = loadRawText("eo-14421-raw-text.txt");

    const result = await runIngestJob(supabase, {
      fetchAllDocuments: async () => [doc],
      fetchRawText: async () => rawText,
    });

    expect(result.status).toBe("success");
    expect(result.newCount).toBe(1);
    expect(result.updatedCount).toBe(0);
    expect(result.errorMessage).toBeUndefined();
    expect(supabase.rows).toHaveLength(1);
    expect(supabase.rows[0].document_number).toBe("2026-17843");

    expect(supabase.ingestionRuns).toHaveLength(1);
    expect(supabase.ingestionRuns[0]).toMatchObject({
      id: result.runId,
      run_type: "federal_register",
      status: "success",
      new_count: 1,
      updated_count: 0,
      error_message: null,
    });
  });

  // Reproduces the 2026-09-19 production failure at job level. On a normal
  // night every document in the 90-day window is already stored, and the
  // job used to download all 47 full texts anyway before discarding them.
  // Those downloads were the only thing federalregister.gov rate-limited.
  it("makes no raw-text request at all on a night where every document is already stored", async () => {
    const doc = loadDoc("eo-14421-detail.json");
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          document_number: doc.document_number,
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
        },
      ],
    });
    const fetchRawText = vi.fn(async () => "raw text");

    const result = await runIngestJob(supabase, { fetchAllDocuments: async () => [doc], fetchRawText });

    expect(result.status).toBe("success");
    expect(result.newCount).toBe(0);
    expect(result.errorMessage).toBeUndefined();
    expect(fetchRawText).not.toHaveBeenCalled();
  });

  it("isolates a per-document failure: one bad document doesn't abort the run, and is reported in errors/partial status", async () => {
    const supabase = createFakeSupabase({});
    const badDoc = loadDoc("eo-14421-detail.json");
    const goodDoc = loadDoc("proclamation-14988-detail.json");
    const goodRawText = loadRawText("eo-14421-raw-text.txt");

    const result = await runIngestJob(supabase, {
      fetchAllDocuments: async () => [badDoc, goodDoc],
      fetchRawText: async (url: string) => {
        if (url === badDoc.raw_text_url) throw new Error("raw text fetch failed");
        return goodRawText;
      },
    });

    expect(result.status).toBe("partial");
    expect(result.newCount).toBe(1); // only the good document counted
    expect(result.errorMessage).toContain(badDoc.document_number);
    expect(result.errorMessage).toContain("raw text fetch failed");
    expect(supabase.rows).toHaveLength(1);
    expect(supabase.rows[0].document_number).toBe(goodDoc.document_number);

    expect(supabase.ingestionRuns[0]).toMatchObject({
      status: "partial",
      new_count: 1,
    });
    expect(supabase.ingestionRuns[0].error_message).toContain(badDoc.document_number);
  });

  it("reports failure — not partial — when every document in the run failed", async () => {
    // A systematically broken run (the Federal Register erroring on every
    // raw-text fetch) must not read as a mostly-healthy "partial". This is
    // the signal anything watching run status for alerting depends on.
    const supabase = createFakeSupabase({});
    const docs = [loadDoc("eo-14421-detail.json"), loadDoc("proclamation-14988-detail.json")];

    const result = await runIngestJob(supabase, {
      fetchAllDocuments: async () => docs,
      fetchRawText: async () => {
        throw new Error("raw text fetch failed");
      },
    });

    expect(result.status).toBe("failure");
    expect(result.newCount).toBe(0);
    expect(supabase.rows).toHaveLength(0);
    expect(supabase.ingestionRuns[0]).toMatchObject({ status: "failure", new_count: 0 });
  });

  it("reports failure without attempting any item when the list request itself fails", async () => {
    const supabase = createFakeSupabase({});

    const result = await runIngestJob(supabase, {
      fetchAllDocuments: async () => {
        throw new Error("Federal Register API request failed (503)");
      },
      fetchRawText: async () => {
        throw new Error("should never be called — the list request already failed");
      },
    });

    expect(result.status).toBe("failure");
    expect(result.newCount).toBe(0);
    expect(result.updatedCount).toBe(0);
    expect(result.errorMessage).toContain("Federal Register API request failed");
    expect(supabase.rows).toHaveLength(0);

    expect(supabase.ingestionRuns).toHaveLength(1);
    expect(supabase.ingestionRuns[0]).toMatchObject({
      status: "failure",
      new_count: 0,
      updated_count: 0,
    });
    expect(supabase.ingestionRuns[0].error_message).toContain("Federal Register API request failed");
  });

  // Originally: "BUG: a finishRun failure leaves the run row stuck
  // 'running', which then jams the overlap guard for good" — found while
  // building this coverage. Now fixed two ways: finishRunSafely (see
  // ingestion-run.ts) no longer lets a failed bookkeeping write crash the
  // job, and startRun's staleness check self-heals a row this leaves stuck,
  // instead of jamming the overlap guard forever. This test now asserts
  // that fixed behavior rather than the bug.
  it("a finishRun failure no longer crashes the job, and the stuck 'running' row self-heals once stale", async () => {
    // A mutable reference (not a fresh object per call) so the "blip" can be
    // toggled off below, the same way a real transient network failure
    // would resolve by the time of a later invocation.
    const failUpdate: Partial<Record<string, string>> = { ingestion_runs: "network blip updating ingestion_runs" };
    const supabase = createFakeSupabase({ failUpdate });
    const doc = loadDoc("eo-14421-detail.json");
    const rawText = loadRawText("eo-14421-raw-text.txt");

    const firstResult = await runIngestJob(supabase, {
      fetchAllDocuments: async () => [doc],
      fetchRawText: async () => rawText,
    });

    // The ingestion itself succeeded (the row was inserted)...
    expect(supabase.rows).toHaveLength(1);
    // ...and finishRunSafely swallows (and logs) the update failure instead
    // of throwing — the job still reports its real result rather than
    // rejecting.
    expect(firstResult.status).toBe("success");
    expect(firstResult.newCount).toBe(1);
    // The run's own bookkeeping never got updated off "running", because
    // the forced update failure is still in effect.
    expect(supabase.ingestionRuns[0].status).toBe("running");

    // A run attempted right away is still correctly refused — the stuck
    // row is fresh, so it looks exactly like a real overlap.
    await expect(
      runIngestJob(supabase, { fetchAllDocuments: async () => [], fetchRawText: async () => "" }),
    ).rejects.toThrow(/already in progress/);

    // Time passes well beyond STALE_RUN_THRESHOLD_MINUTES with the row
    // never having been fixed by hand (simulated directly on the fake,
    // rather than waiting or faking timers), and the transient blip itself
    // has since resolved — real network blips don't stay broken forever,
    // and startRun still needs to be able to write the stale-supersession
    // marker for the self-heal to actually go through.
    supabase.ingestionRuns[0].started_at = new Date(
      Date.now() - (STALE_RUN_THRESHOLD_MINUTES + 1) * MS_PER_MINUTE,
    ).toISOString();
    delete failUpdate.ingestion_runs;

    const secondResult = await runIngestJob(supabase, {
      fetchAllDocuments: async () => [],
      fetchRawText: async () => "",
    });

    // The guard no longer refuses forever: it self-heals the abandoned row...
    expect(supabase.ingestionRuns[0]).toMatchObject({ status: "failure" });
    expect(supabase.ingestionRuns[0].error_message).toMatch(/stale/i);
    // ...and lets the new run actually proceed.
    expect(secondResult.status).toBe("success");
    expect(supabase.ingestionRuns).toHaveLength(2);
    expect(supabase.ingestionRuns[1].run_type).toBe("federal_register");
  });
});
