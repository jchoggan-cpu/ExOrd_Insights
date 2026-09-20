import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { buildRecordFromDocument, extractDocumentNumber, syncDocument } from "@/lib/federal-register/sync";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

const FIXTURE_DIR = join(__dirname, "fixtures");

function loadDoc(name: string): FederalRegisterDocument {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8"));
}

describe("extractDocumentNumber", () => {
  it("pulls the trailing path segment from a Federal Register resource URL", () => {
    expect(extractDocumentNumber("https://www.federalregister.gov/api/v1/documents/2026-03829")).toBe(
      "2026-03829",
    );
  });
});

describe("buildRecordFromDocument", () => {
  it("maps a plain Executive Order (no disposition notes) to active status", () => {
    const doc = loadDoc("eo-14421-detail.json");
    const record = buildRecordFromDocument(doc, "Executive Order 14421 of August 26, 2026. Some order text.");

    expect(record).toMatchObject({
      document_number: "2026-17843",
      eo_number: "EO 14421",
      action_type: "Executive Order",
      status: "active",
      citation: "91 FR 55995",
    });
    expect(record.full_text).toContain("Executive Order 14421");
  });

  it("derives 'amended' status from a real disposition_notes value and cleans full_text", () => {
    const doc = loadDoc("eo-14146-with-disposition-notes.json");
    const record = buildRecordFromDocument(doc, "raw text");

    expect(record.status).toBe("amended");
    expect(record.source_notes).toContain("Revokes in part");
  });

  it("leaves eo_number null for a Proclamation, using subtype as action_type", () => {
    const doc = loadDoc("proclamation-14988-detail.json");
    const record = buildRecordFromDocument(doc, "raw text");

    expect(record.eo_number).toBeNull();
    expect(record.action_type).toBe("Proclamation");
  });
});

describe("syncDocument", () => {
  it("inserts a document with no existing row and no correction_of", async () => {
    const supabase = createFakeSupabase({ rows: [] });
    const doc = loadDoc("eo-14421-detail.json");

    const outcome = await syncDocument(supabase, doc, async () => "raw text");

    expect(outcome).toEqual({ documentNumber: "2026-17843", action: "inserted" });
    expect(supabase.rows).toHaveLength(1);
    expect(supabase.rows[0].document_number).toBe("2026-17843");
  });

  it("reports unchanged when the document_number already exists", async () => {
    const supabase = createFakeSupabase({
      rows: [{ id: "row-1", document_number: "2026-17843", manually_edited_fields: [], applied_correction_document_numbers: [] }],
    });
    const doc = loadDoc("eo-14421-detail.json");

    const outcome = await syncDocument(supabase, doc, async () => "raw text");

    expect(outcome.action).toBe("unchanged");
    expect(supabase.rows).toHaveLength(1);
  });

  // The 2026-09-19 outage: 47 documents in the ingest window, all 47
  // already stored, all 47 raw-text downloads refused with a 429 — every
  // one of them for text that was about to be discarded.
  it("never downloads the text of a document it already has", async () => {
    const supabase = createFakeSupabase({
      rows: [{ id: "row-1", document_number: "2026-17843", manually_edited_fields: [], applied_correction_document_numbers: [] }],
    });
    const fetchRawFullText = vi.fn(async () => "raw text");

    const outcome = await syncDocument(supabase, loadDoc("eo-14421-detail.json"), fetchRawFullText);

    expect(outcome.action).toBe("unchanged");
    expect(fetchRawFullText).not.toHaveBeenCalled();
  });

  it("does not download the text of a correction it has decided not to apply", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          document_number: "2026-03829",
          eo_number: "EO 14388",
          manually_edited_fields: ["title"],
          applied_correction_document_numbers: [],
        },
      ],
    });
    const fetchRawFullText = vi.fn(async () => "corrected raw text");

    const outcome = await syncDocument(supabase, loadDoc("eo-14388-correction-document.json"), fetchRawFullText);

    expect(outcome.action).toBe("flagged");
    expect(fetchRawFullText).not.toHaveBeenCalled();
  });

  it("does not download the text of a correction whose target is missing", async () => {
    const supabase = createFakeSupabase({ rows: [] });
    const fetchRawFullText = vi.fn(async () => "corrected raw text");

    const outcome = await syncDocument(supabase, loadDoc("eo-14388-correction-document.json"), fetchRawFullText);

    expect(outcome.action).toBe("skipped_correction_target_missing");
    expect(fetchRawFullText).not.toHaveBeenCalled();
  });

  // The other half of the guarantee: skipping the fetch must not become
  // skipping the text. Every branch that stores a row still pays for it.
  it("downloads the text exactly once for a document it does store", async () => {
    const supabase = createFakeSupabase({ rows: [] });
    const fetchRawFullText = vi.fn(async () => "Executive Order 14421 text.");

    const outcome = await syncDocument(supabase, loadDoc("eo-14421-detail.json"), fetchRawFullText);

    expect(outcome.action).toBe("inserted");
    expect(fetchRawFullText).toHaveBeenCalledTimes(1);
    expect(supabase.rows[0].full_text).toContain("Executive Order 14421");
  });

  it("downloads the text exactly once for a correction it does apply", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          document_number: "2026-03829",
          eo_number: "EO 14388",
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
          full_text: "old text",
        },
      ],
    });
    const fetchRawFullText = vi.fn(async () => "corrected raw text");

    const outcome = await syncDocument(supabase, loadDoc("eo-14388-correction-document.json"), fetchRawFullText);

    expect(outcome.action).toBe("updated");
    expect(fetchRawFullText).toHaveBeenCalledTimes(1);
    expect(supabase.rows[0].full_text).toContain("corrected raw text");
  });

  it("applies a correction to the row it targets, recording the correction's document_number", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          document_number: "2026-03829",
          eo_number: "EO 14388",
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
          full_text: "old text",
        },
      ],
    });
    const correction = loadDoc("eo-14388-correction-document.json");

    const outcome = await syncDocument(supabase, correction, async () => "corrected raw text");

    expect(outcome.action).toBe("updated");
    expect(supabase.rows[0].applied_correction_document_numbers).toEqual(["R1-2026-03829"]);
    expect(supabase.rows[0].document_number).toBe("2026-03829"); // stable identity, not overwritten by the correction's own number
  });

  it("flags for review instead of overwriting a manually-edited field, and still records the correction as accounted for", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          document_number: "2026-03829",
          eo_number: "EO 14388",
          manually_edited_fields: ["title"],
          applied_correction_document_numbers: [],
        },
      ],
    });
    const correction = loadDoc("eo-14388-correction-document.json");

    const outcome = await syncDocument(supabase, correction, async () => "corrected raw text");

    expect(outcome.action).toBe("flagged");
    expect(supabase.rows[0].needs_review).toBe(true);
    expect(supabase.rows[0].title).toBeUndefined(); // never overwritten
    // Without this, reconciliation would see the correction's document_number
    // as an unaccounted-for gap and re-flag it forever.
    expect(supabase.rows[0].applied_correction_document_numbers).toEqual(["R1-2026-03829"]);
  });

  it("skips (rather than crashes) when a correction's target hasn't been ingested yet", async () => {
    const supabase = createFakeSupabase({ rows: [] });
    const correction = loadDoc("eo-14388-correction-document.json");

    const outcome = await syncDocument(supabase, correction, async () => "corrected raw text");

    expect(outcome.action).toBe("skipped_correction_target_missing");
  });

  it("flags rather than duplicates when an unreconciled legacy row shares the same eo_number", async () => {
    // Simulates either ordering hazard: the backfill hasn't run yet, or it
    // flagged this EO as an ambiguous match rather than linking it.
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "legacy-row-1",
          document_number: null,
          eo_number: "EO 14421",
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
          needs_review: false,
        },
      ],
    });
    const doc = loadDoc("eo-14421-detail.json");

    const outcome = await syncDocument(supabase, doc, async () => "raw text");

    expect(outcome.action).toBe("flagged");
    expect(supabase.rows).toHaveLength(1); // no duplicate row inserted
    expect(supabase.rows[0].needs_review).toBe(true);
  });

  it("flags rather than duplicates a proclamation, which has no eo_number to match on", async () => {
    // The regression behind the 62 duplicates merged on 2026-09-16: the
    // guard used to run only when the incoming record had an eo_number, so
    // every proclamation and memorandum walked straight past it and was
    // inserted alongside the firm's existing row.
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "legacy-row-1",
          document_number: null,
          eo_number: null,
          title: "Martin Luther King, Jr., Federal Holiday, 2025",
          date_signed: "2025-01-17",
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
          needs_review: false,
        },
      ],
    });
    const doc = loadDoc("proclamation-14988-detail.json");

    const outcome = await syncDocument(supabase, doc, async () => "raw text");

    expect(outcome.action).toBe("flagged");
    expect(outcome.detail).toContain("title_and_date");
    expect(supabase.rows).toHaveLength(1); // no duplicate row inserted
    expect(supabase.rows[0].needs_review).toBe(true);
  });

  it("still inserts a proclamation when no legacy row shares its title and date", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "legacy-row-1",
          document_number: null,
          eo_number: null,
          title: "A Completely Different Proclamation",
          date_signed: "2025-01-17",
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
          needs_review: false,
        },
      ],
    });
    const doc = loadDoc("proclamation-14988-detail.json");

    const outcome = await syncDocument(supabase, doc, async () => "raw text");

    expect(outcome.action).toBe("inserted");
    expect(supabase.rows).toHaveLength(2);
  });

  it("does not clobber an existing, more specific review_reason on the unlinked legacy row", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "legacy-row-1",
          document_number: null,
          eo_number: "EO 14421",
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
          needs_review: true,
          review_reason: "Backfill's own specific reason.",
        },
      ],
    });
    const doc = loadDoc("eo-14421-detail.json");

    await syncDocument(supabase, doc, async () => "raw text");

    expect(supabase.rows[0].review_reason).toBe("Backfill's own specific reason.");
  });
});
