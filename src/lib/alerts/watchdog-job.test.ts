import { describe, expect, it, vi } from "vitest";
import { runWatchdogJob } from "@/lib/alerts/watchdog-job";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

const WEBHOOK = "https://hooks.slack.com/services/T000/B000/xxxx";
const SITE = "https://ex-ord-insights.vercel.app";
const NOW = new Date("2026-09-17T12:00:00Z");
const MS_PER_HOUR = 3_600_000;

function hoursBefore(hours: number): string {
  return new Date(NOW.getTime() - hours * MS_PER_HOUR).toISOString();
}

function okFetch() {
  return vi.fn(async () => new Response("ok", { status: 200 })) as unknown as typeof fetch;
}

function sentText(fetchImpl: typeof fetch): string {
  const [, init] = (fetchImpl as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
  return JSON.parse(init.body as string).text as string;
}

/** ingestion_runs rows for three jobs that all ran on time and succeeded. */
function healthyRunRows() {
  return [
    { run_type: "federal_register", status: "success", started_at: hoursBefore(2), new_count: 0, updated_count: 0, error_message: null },
    { run_type: "federal_register_enrichment", status: "success", started_at: hoursBefore(1.5), new_count: 0, updated_count: 2, error_message: null },
    { run_type: "federal_register_reconciliation", status: "success", started_at: hoursBefore(72), new_count: 0, updated_count: 0, error_message: null },
  ];
}

describe("runWatchdogJob", () => {
  it("sends nothing when the pipeline is healthy and no all-clear is due", async () => {
    const supabase = createFakeSupabase({ ingestionRuns: healthyRunRows() });
    const fetchImpl = okFetch();

    const result = await runWatchdogJob(supabase, { webhookUrl: WEBHOOK, siteUrl: SITE }, { now: NOW, fetchImpl });

    expect(result).toEqual({ problemCount: 0, sent: false });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports a dead cron to Slack, with a link to Needs Attention", async () => {
    const runs = healthyRunRows().filter((r) => r.run_type !== "federal_register");
    runs.push({ ...healthyRunRows()[0], started_at: hoursBefore(30) });
    const supabase = createFakeSupabase({ ingestionRuns: runs });
    const fetchImpl = okFetch();

    const result = await runWatchdogJob(supabase, { webhookUrl: WEBHOOK, siteUrl: SITE }, { now: NOW, fetchImpl });

    expect(result.problemCount).toBe(1);
    expect(result.sent).toBe(true);
    const text = sentText(fetchImpl);
    expect(text).toContain("federal_register has not run since");
    expect(text).toContain(`${SITE}/needs-attention`);
  });

  it("sends the weekly all-clear when everything is healthy on the all-clear day", async () => {
    const monday = new Date("2026-09-21T12:00:00Z");
    const runs = [
      { run_type: "federal_register", status: "success", started_at: new Date(monday.getTime() - 2 * MS_PER_HOUR).toISOString(), new_count: 0, updated_count: 0, error_message: null },
      { run_type: "federal_register_enrichment", status: "success", started_at: new Date(monday.getTime() - 1.5 * MS_PER_HOUR).toISOString(), new_count: 0, updated_count: 1, error_message: null },
      { run_type: "federal_register_reconciliation", status: "success", started_at: new Date(monday.getTime() - MS_PER_HOUR).toISOString(), new_count: 0, updated_count: 0, error_message: null },
    ];
    const supabase = createFakeSupabase({ ingestionRuns: runs });
    const fetchImpl = okFetch();

    const result = await runWatchdogJob(supabase, { webhookUrl: WEBHOOK, siteUrl: SITE }, { now: monday, fetchImpl });

    expect(result.problemCount).toBe(0);
    expect(result.sent).toBe(true);
    expect(sentText(fetchImpl)).toContain("weekly all-clear");
  });

  it("counts the enrichment queue by the same rule the enrichment job selects by", async () => {
    // applyEnrichQueueFilter is shared by the job, this watchdog and
    // enrich:all precisely so the three cannot disagree. If the watchdog
    // counted rows the job would not select, it would report work
    // permanently waiting that nothing was ever going to pick up.
    // Neither row below qualifies: one is already summarized, the other is
    // legacy-only with no source text to summarize from.
    const runs = healthyRunRows().map((r) =>
      r.run_type === "federal_register_enrichment" ? { ...r, updated_count: 0 } : r,
    );
    runs.push({
      run_type: "federal_register_enrichment",
      status: "success",
      started_at: hoursBefore(25.5),
      new_count: 0,
      updated_count: 0,
      error_message: null,
    });
    const supabase = createFakeSupabase({
      ingestionRuns: runs,
      rows: [
        { id: "already-summarized", ai_summary: "done", full_text: "text", needs_review: false },
        { id: "legacy-only", ai_summary: null, full_text: null, needs_review: false },
      ],
    });
    const fetchImpl = okFetch();

    const result = await runWatchdogJob(supabase, { webhookUrl: WEBHOOK, siteUrl: SITE }, { now: NOW, fetchImpl });

    // Queue depth is 0, so even two consecutive zero-progress runs say
    // nothing is wrong — there was never anything for them to do.
    expect(result.problemCount).toBe(0);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("reports rows genuinely waiting while the last two enrichment runs moved none", async () => {
    const runs = healthyRunRows().map((r) =>
      r.run_type === "federal_register_enrichment" ? { ...r, updated_count: 0 } : r,
    );
    // A second, earlier enrichment run that also moved nothing — one alone
    // is an ordinary ingest/enrich ordering race, not a stall.
    runs.push({
      run_type: "federal_register_enrichment",
      status: "success",
      started_at: hoursBefore(25.5),
      new_count: 0,
      updated_count: 0,
      error_message: null,
    });
    const supabase = createFakeSupabase({
      ingestionRuns: runs,
      rows: [
        { id: "waiting-a", ai_summary: null, full_text: "text", needs_review: false },
        { id: "waiting-b", ai_summary: null, full_text: "text", needs_review: false },
      ],
    });
    const fetchImpl = okFetch();

    const result = await runWatchdogJob(supabase, { webhookUrl: WEBHOOK, siteUrl: SITE }, { now: NOW, fetchImpl });

    expect(result.problemCount).toBe(1);
    expect(sentText(fetchImpl)).toContain("2 rows are waiting");
  });

  it("still speaks when it cannot read the database at all", async () => {
    // The blind spot in every naive version of this idea: a watchdog that
    // can only speak when its database answers is silent exactly when the
    // database is the problem.
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const supabase = createFakeSupabase({ failSelect: { ingestion_runs: "connection refused" } });
    const fetchImpl = okFetch();

    const result = await runWatchdogJob(supabase, { webhookUrl: WEBHOOK, siteUrl: SITE }, { now: NOW, fetchImpl });

    expect(result.readError).toContain("connection refused");
    expect(result.sent).toBe(true);
    expect(sentText(fetchImpl)).toContain("cannot see the database");
    logged.mockRestore();
  });

  it("logs loudly when it found a problem but could not deliver the alert", async () => {
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    const runs = healthyRunRows().filter((r) => r.run_type !== "federal_register");
    runs.push({ ...healthyRunRows()[0], started_at: hoursBefore(30) });
    const supabase = createFakeSupabase({ ingestionRuns: runs });
    const failing = vi.fn(async () => new Response("no_service", { status: 404 })) as unknown as typeof fetch;

    const result = await runWatchdogJob(supabase, { webhookUrl: WEBHOOK, siteUrl: SITE }, { now: NOW, fetchImpl: failing });

    expect(result.sent).toBe(false);
    expect(logged).toHaveBeenCalledWith(expect.stringContaining("could not deliver"));
    logged.mockRestore();
  });
});
