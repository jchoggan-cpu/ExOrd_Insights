import { describe, expect, it } from "vitest";
import {
  findUnlinkedLegacyRow,
  flagUnlinkedLegacyRow,
  type IncomingRecord,
} from "@/lib/federal-register/find-unlinked-legacy";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

const DOCUMENT_NUMBER = "2025-06160";

function incoming(overrides: Partial<IncomingRecord> = {}): IncomingRecord {
  return {
    eo_number: null,
    title: "National Donate Life Month, 2025",
    date_signed: "2025-04-03",
    ...overrides,
  };
}

function legacyRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "legacy-1",
    eo_number: null,
    title: "National Donate Life Month, 2025",
    date_signed: "2025-04-03",
    document_number: null,
    needs_review: false,
    review_reason: null,
    ...overrides,
  };
}

describe("findUnlinkedLegacyRow", () => {
  it("finds an unlinked legacy row by eo_number", async () => {
    const supabase = createFakeSupabase({
      rows: [legacyRow({ eo_number: "EO 14319", title: "Preventing Woke AI in the Federal Government" })],
    });

    const match = await findUnlinkedLegacyRow(
      supabase,
      incoming({ eo_number: "EO 14319", title: "Preventing Woke AI in the Federal Government" }),
      DOCUMENT_NUMBER,
    );

    expect(match).toMatchObject({ id: "legacy-1", matchedOn: "eo_number" });
  });

  it("finds a proclamation by title and signing date, which has no eo_number to match on", async () => {
    const supabase = createFakeSupabase({ rows: [legacyRow()] });

    const match = await findUnlinkedLegacyRow(supabase, incoming(), DOCUMENT_NUMBER);

    expect(match).toMatchObject({ id: "legacy-1", matchedOn: "title_and_date" });
  });

  it("matches across casing and punctuation differences in the title", async () => {
    const supabase = createFakeSupabase({
      rows: [
        legacyRow({ title: "Regulatory Relief for Certain Stationary Sources to Promote American Energy" }),
      ],
    });

    const match = await findUnlinkedLegacyRow(
      supabase,
      incoming({ title: "Regulatory Relief for Certain Stationary Sources To Promote American Energy" }),
      DOCUMENT_NUMBER,
    );

    expect(match?.matchedOn).toBe("title_and_date");
  });

  it("does not match a same-titled order signed on a different date", async () => {
    const supabase = createFakeSupabase({
      rows: [
        legacyRow({ title: "Further Extending the TikTok Enforcement Delay", date_signed: "2025-06-19" }),
      ],
    });

    const match = await findUnlinkedLegacyRow(
      supabase,
      incoming({ title: "Further Extending the TikTok Enforcement Delay", date_signed: "2025-09-16" }),
      DOCUMENT_NUMBER,
    );

    expect(match).toBeNull();
  });

  it("ignores a row that is already linked to a Federal Register document", async () => {
    const supabase = createFakeSupabase({ rows: [legacyRow({ document_number: "2025-00001" })] });

    expect(await findUnlinkedLegacyRow(supabase, incoming(), DOCUMENT_NUMBER)).toBeNull();
  });

  it("returns null for a genuinely new document, so it gets inserted", async () => {
    const supabase = createFakeSupabase({ rows: [legacyRow({ title: "Something Else Entirely" })] });

    expect(await findUnlinkedLegacyRow(supabase, incoming(), DOCUMENT_NUMBER)).toBeNull();
  });

  it("does not attempt a title match when the incoming document has no signing date", async () => {
    const supabase = createFakeSupabase({ rows: [legacyRow({ date_signed: null })] });

    expect(await findUnlinkedLegacyRow(supabase, incoming({ date_signed: null }), DOCUMENT_NUMBER)).toBeNull();
  });

  it("prefers the eo_number match when both signals point at different rows", async () => {
    const supabase = createFakeSupabase({
      rows: [
        legacyRow({ id: "by-title" }),
        legacyRow({ id: "by-eo-number", eo_number: "EO 14319", title: "A Different Title", date_signed: "2025-01-01" }),
      ],
    });

    const match = await findUnlinkedLegacyRow(supabase, incoming({ eo_number: "EO 14319" }), DOCUMENT_NUMBER);

    expect(match).toMatchObject({ id: "by-eo-number", matchedOn: "eo_number" });
  });
});

describe("flagUnlinkedLegacyRow", () => {
  it("flags the matched row with a reason naming the signal that fired", async () => {
    const rows = [legacyRow()];
    const supabase = createFakeSupabase({ rows: rows });

    const match = await findUnlinkedLegacyRow(supabase, incoming(), DOCUMENT_NUMBER);
    await flagUnlinkedLegacyRow(supabase, match!, DOCUMENT_NUMBER, incoming());

    expect(rows[0].needs_review).toBe(true);
    expect(rows[0].review_reason).toContain(DOCUMENT_NUMBER);
    expect(rows[0].review_reason).toContain("title and signing date");
  });

  it("names the eo_number in the reason when that is what matched", async () => {
    const rows = [legacyRow({ eo_number: "EO 14319" })];
    const supabase = createFakeSupabase({ rows: rows });
    const record = incoming({ eo_number: "EO 14319" });

    const match = await findUnlinkedLegacyRow(supabase, record, DOCUMENT_NUMBER);
    await flagUnlinkedLegacyRow(supabase, match!, DOCUMENT_NUMBER, record);

    expect(rows[0].review_reason).toContain("EO 14319");
  });

  it("leaves an existing review reason alone rather than overwriting a more specific one", async () => {
    const rows = [legacyRow({ needs_review: true, review_reason: "Backfill could not confidently match this row." })];
    const supabase = createFakeSupabase({ rows: rows });

    const match = await findUnlinkedLegacyRow(supabase, incoming(), DOCUMENT_NUMBER);
    await flagUnlinkedLegacyRow(supabase, match!, DOCUMENT_NUMBER, incoming());

    expect(rows[0].review_reason).toBe("Backfill could not confidently match this row.");
  });
});
