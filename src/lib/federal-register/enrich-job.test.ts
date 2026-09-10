import type Anthropic from "@anthropic-ai/sdk";
import { describe, expect, it, vi } from "vitest";
import { runEnrichJob } from "@/lib/federal-register/enrich-job";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

// A minimal in-memory stand-in for the Anthropic client — just enough of
// `messages.create` for summarizeDocument to call. Test-only; never a real
// network call. `responses` is consumed in order, one per call.
function createFakeAnthropic(responses: Array<{ text: string } | { throw: string }>): Anthropic {
  let call = 0;
  return {
    messages: {
      create: async () => {
        const next = responses[call];
        call++;
        if (!next) throw new Error("createFakeAnthropic: ran out of scripted responses");
        if ("throw" in next) throw new Error(next.throw);
        return { content: [{ type: "text", text: next.text }], stop_reason: "end_turn" };
      },
    },
  } as unknown as Anthropic;
}

function summaryJson(summary: string): string {
  return JSON.stringify({ summary, subjectArea: ["Trade Policy"], practiceAreas: [], industries: [] });
}

describe("runEnrichJob", () => {
  it("happy path: summarizes an enrichable row and writes the verified fields", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          title: "Some Order",
          action_type: "Executive Order",
          full_text: "The order directs agencies to review the policy.",
          manually_edited_fields: [],
          ai_summary: null,
        },
      ],
    });
    const anthropic = createFakeAnthropic([{ text: summaryJson("The order directs agencies to review the policy.") }]);

    const result = await runEnrichJob(supabase, anthropic);

    expect(result.status).toBe("success");
    expect(result.updatedCount).toBe(1);
    expect(result.flaggedCount).toBe(0);
    expect(result.errorMessage).toBeUndefined();
    expect(supabase.rows[0].ai_summary).toBe("The order directs agencies to review the policy.");
    expect(supabase.rows[0].subject_area).toEqual(["Trade Policy"]);

    expect(supabase.ingestionRuns[0]).toMatchObject({
      id: result.runId,
      run_type: "federal_register_enrichment",
      status: "success",
      updated_count: 1,
    });
  });

  it("isolates a per-row failure: one bad row doesn't abort the batch, and is reported in errors/partial status", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "bad-row",
          title: "Bad Order",
          action_type: "Executive Order",
          full_text: "text",
          manually_edited_fields: [],
          ai_summary: null,
        },
        {
          id: "good-row",
          title: "Good Order",
          action_type: "Executive Order",
          full_text: "The order directs agencies to comply.",
          manually_edited_fields: [],
          ai_summary: null,
        },
      ],
    });
    const anthropic = createFakeAnthropic([
      { throw: "model call failed" },
      { text: summaryJson("The order directs agencies to comply.") },
    ]);

    const result = await runEnrichJob(supabase, anthropic);

    expect(result.status).toBe("partial");
    expect(result.updatedCount).toBe(1); // only the good row counted
    expect(result.errorMessage).toContain("bad-row");
    expect(result.errorMessage).toContain("model call failed");
    expect(supabase.rows.find((r) => r.id === "good-row")?.ai_summary).toBe("The order directs agencies to comply.");
    expect(supabase.rows.find((r) => r.id === "bad-row")?.ai_summary ?? null).toBeNull();
  });

  it("flags rather than saves a summary whose quote can't be verified against full_text, without erroring the run", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          title: "Some Order",
          action_type: "Executive Order",
          full_text: "The order directs agencies to review the policy.",
          manually_edited_fields: [],
          ai_summary: null,
        },
      ],
    });
    const anthropic = createFakeAnthropic([
      { text: summaryJson('The order states "this text does not appear anywhere in the source".') },
    ]);

    const result = await runEnrichJob(supabase, anthropic);

    expect(result.status).toBe("success"); // a flag isn't a per-item error
    expect(result.updatedCount).toBe(0);
    expect(result.flaggedCount).toBe(1);
    expect(supabase.rows[0].needs_review).toBe(true);
    expect(supabase.rows[0].review_reason).toContain("not found verbatim");
    expect(supabase.rows[0].ai_summary).toBeNull(); // never saved
  });

  it("reports failure without attempting any row when loading enrichable rows from Supabase fails", async () => {
    const supabase = createFakeSupabase({ failSelect: { executive_orders: "connection lost" } });
    const create = vi.fn(async () => {
      throw new Error("should never be called — the row query already failed");
    });
    const anthropic = { messages: { create } } as unknown as Anthropic;

    const result = await runEnrichJob(supabase, anthropic);

    expect(result.status).toBe("failure");
    expect(result.updatedCount).toBe(0);
    expect(result.flaggedCount).toBe(0);
    expect(result.errorMessage).toContain("connection lost");
    expect(create).not.toHaveBeenCalled();

    expect(supabase.ingestionRuns[0]).toMatchObject({ status: "failure" });
  });
});
