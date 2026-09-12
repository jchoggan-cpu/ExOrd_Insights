import { describe, expect, it } from "vitest";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";
import {
  listSummaryPrompts,
  loadActiveSummaryPrompt,
  saveSummaryPrompt,
} from "@/lib/summary-prompt/store";
import { DEFAULT_SUMMARY_PROMPT } from "@/lib/summary-prompt/default-prompt";

/** A minimal prompt that satisfies validateSummaryPrompt, so these tests exercise storage rather than validation. */
const VALID_PROMPT = "Return JSON with summary, subjectArea, practiceAreas, industries.";

describe("loadActiveSummaryPrompt", () => {
  it("falls back to the built-in default when nothing has been saved", async () => {
    const supabase = createFakeSupabase({});
    const active = await loadActiveSummaryPrompt(supabase);

    expect(active).toEqual({ id: null, body: DEFAULT_SUMMARY_PROMPT, isDefault: true });
  });

  it("returns the active row when one exists", async () => {
    const supabase = createFakeSupabase({});
    await saveSummaryPrompt(supabase, { body: VALID_PROMPT, note: "first" });

    const active = await loadActiveSummaryPrompt(supabase);
    expect(active.body).toBe(VALID_PROMPT);
    expect(active.isDefault).toBe(false);
    expect(active.id).toBeTruthy();
  });

  it("throws rather than silently defaulting when the read fails", async () => {
    const supabase = createFakeSupabase({ failSelect: { summary_prompts: "connection reset" } });

    await expect(loadActiveSummaryPrompt(supabase)).rejects.toThrow(/connection reset/);
  });
});

describe("saveSummaryPrompt", () => {
  it("refuses a prompt that breaks the response contract", async () => {
    const supabase = createFakeSupabase({});

    await expect(saveSummaryPrompt(supabase, { body: "Just write a nice summary." })).rejects.toThrow(
      /Refusing to save an unusable prompt/,
    );
  });

  it("leaves exactly one active version after consecutive saves", async () => {
    const supabase = createFakeSupabase({});
    await saveSummaryPrompt(supabase, { body: `${VALID_PROMPT} v1` });
    await saveSummaryPrompt(supabase, { body: `${VALID_PROMPT} v2` });

    const history = await listSummaryPrompts(supabase);
    expect(history).toHaveLength(2);
    expect(history.filter((v) => v.isActive)).toHaveLength(1);

    const active = await loadActiveSummaryPrompt(supabase);
    expect(active.body).toBe(`${VALID_PROMPT} v2`);
  });

  it("keeps the superseded version readable rather than overwriting it", async () => {
    const supabase = createFakeSupabase({});
    await saveSummaryPrompt(supabase, { body: `${VALID_PROMPT} v1`, note: "original" });
    await saveSummaryPrompt(supabase, { body: `${VALID_PROMPT} v2`, note: "revised" });

    const bodies = (await listSummaryPrompts(supabase)).map((v) => v.body);
    expect(bodies).toContain(`${VALID_PROMPT} v1`);
    expect(bodies).toContain(`${VALID_PROMPT} v2`);
  });

  it("normalizes a blank note to null instead of storing whitespace", async () => {
    const supabase = createFakeSupabase({});
    await saveSummaryPrompt(supabase, { body: VALID_PROMPT, note: "   " });

    expect((await listSummaryPrompts(supabase))[0].note).toBeNull();
  });

  it("reports loudly when the new version cannot be activated", async () => {
    const supabase = createFakeSupabase({ failUpdate: { summary_prompts: "permission denied" } });

    await expect(saveSummaryPrompt(supabase, { body: VALID_PROMPT })).rejects.toThrow(
      /permission denied/,
    );
  });
});
