import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it } from "vitest";
import { runDraftJob } from "@/lib/federal-register/draft-job";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";
import { SUBJECT_AREAS } from "@/lib/taxonomy";

function fakeAnthropic(responses: Array<{ text: string } | { throw: string }>): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const next = responses[call++];
        if (!next) throw new Error("fakeAnthropic: ran out of scripted responses");
        if ("throw" in next) throw new Error(next.throw);
        return { content: [{ type: "text", text: next.text }], stop_reason: "end_turn" };
      },
    },
  } as unknown as Anthropic;
}

function summaryJson(summary: string): string {
  return JSON.stringify({
    summary,
    subjectArea: [SUBJECT_AREAS[0]],
    practiceAreas: [],
    industries: [],
    deliverables: null,
  });
}

const CURATED_TEXT = "The firm's own hand-written summary.";

function curatedRow(id: string) {
  return {
    id,
    title: `Order ${id}`,
    action_type: "Executive Order",
    ai_summary: CURATED_TEXT,
    full_text: "This order directs agencies to review the policy.",
  };
}

describe("runDraftJob", () => {
  it("writes a draft without touching the curated summary", async () => {
    const supabase = createFakeSupabase({ rows: [curatedRow("row-1")] });
    const result = await runDraftJob(supabase, {
      anthropicClient: fakeAnthropic([{ text: summaryJson("This EO directs agencies to review the policy.") }]),
      limit: 10,
    });

    expect(result).toMatchObject({ attempted: 1, written: 1, flaggedQuoteCount: 0, errors: [] });
    // The whole point of this job: the firm's text survives untouched.
    expect(supabase.rows[0].ai_summary).toBe(CURATED_TEXT);

    const { data: drafts } = await supabase.from("summary_drafts").select("*");
    expect(drafts).toHaveLength(1);
    expect(drafts![0]).toMatchObject({
      executive_order_id: "row-1",
      summary: "This EO directs agencies to review the policy.",
      subject_area: [SUBJECT_AREAS[0]],
    });
  });

  it("skips rows with no summary — those belong to the nightly enrich job", async () => {
    const supabase = createFakeSupabase({
      rows: [{ ...curatedRow("row-1"), ai_summary: null }],
    });

    const result = await runDraftJob(supabase, { anthropicClient: fakeAnthropic([]), limit: 10 });
    expect(result).toMatchObject({ attempted: 0, written: 0 });
  });

  it("skips rows with no full text, which cannot be re-summarized at all", async () => {
    const supabase = createFakeSupabase({ rows: [{ ...curatedRow("row-1"), full_text: null }] });

    const result = await runDraftJob(supabase, { anthropicClient: fakeAnthropic([]), limit: 10 });
    expect(result).toMatchObject({ attempted: 0, written: 0 });
  });

  it("keeps a draft whose quote can't be verified, flagged rather than discarded", async () => {
    const supabase = createFakeSupabase({ rows: [curatedRow("row-1")] });
    const result = await runDraftJob(supabase, {
      anthropicClient: fakeAnthropic([{ text: summaryJson('It declares a "national emergency" today.') }]),
      limit: 10,
    });

    expect(result.written).toBe(1);
    expect(result.flaggedQuoteCount).toBe(1);

    const { data: drafts } = await supabase.from("summary_drafts").select("*");
    expect(drafts![0].unverified_quotes).toEqual(["national emergency"]);
  });

  it("isolates a per-row failure so one bad row doesn't abort the pass", async () => {
    const supabase = createFakeSupabase({ rows: [curatedRow("row-1"), curatedRow("row-2")] });
    const result = await runDraftJob(supabase, {
      anthropicClient: fakeAnthropic([{ throw: "overloaded" }, { text: summaryJson("Second one worked.") }]),
      limit: 10,
    });

    expect(result).toMatchObject({ attempted: 2, written: 1 });
    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain("overloaded");
  });

  it("walks forward through the backlog instead of re-drafting the same rows", async () => {
    const supabase = createFakeSupabase({ rows: [curatedRow("row-1"), curatedRow("row-2")] });
    const anthropic = fakeAnthropic([{ text: summaryJson("First row.") }, { text: summaryJson("Second row.") }]);

    const first = await runDraftJob(supabase, { anthropicClient: anthropic, limit: 1 });
    const second = await runDraftJob(supabase, { anthropicClient: anthropic, limit: 1 });

    expect(first.written).toBe(1);
    expect(second.written).toBe(1);

    const { data: drafts } = await supabase.from("summary_drafts").select("*");
    expect(drafts).toHaveLength(2);
    expect(new Set(drafts!.map((d) => d.executive_order_id))).toEqual(new Set(["row-1", "row-2"]));
  });

  it("reports nothing left to do once every row is drafted", async () => {
    const supabase = createFakeSupabase({ rows: [curatedRow("row-1")] });
    const anthropic = fakeAnthropic([{ text: summaryJson("Only pass.") }]);

    await runDraftJob(supabase, { anthropicClient: anthropic, limit: 10 });
    const second = await runDraftJob(supabase, { anthropicClient: anthropic, limit: 10 });

    expect(second).toMatchObject({ attempted: 0, written: 0 });
  });

  it("replaces the existing draft when redraft is explicitly requested", async () => {
    const supabase = createFakeSupabase({ rows: [curatedRow("row-1")] });
    const anthropic = fakeAnthropic([{ text: summaryJson("First pass.") }, { text: summaryJson("Second pass.") }]);

    await runDraftJob(supabase, { anthropicClient: anthropic, limit: 10 });
    await runDraftJob(supabase, { anthropicClient: anthropic, limit: 10, redraft: true });

    const { data: drafts } = await supabase.from("summary_drafts").select("*");
    expect(drafts).toHaveLength(1);
    expect(drafts![0].summary).toBe("Second pass.");
  });

  it("reports a failed row load loudly instead of returning an empty pass", async () => {
    const supabase = createFakeSupabase({ failSelect: { executive_orders: "connection reset" } });

    await expect(
      runDraftJob(supabase, { anthropicClient: fakeAnthropic([]), limit: 10 }),
    ).rejects.toThrow(/connection reset/);
  });
});
