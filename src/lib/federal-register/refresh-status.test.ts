import { describe, expect, it, vi } from "vitest";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";
import { syncDocument } from "@/lib/federal-register/sync";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";

/**
 * A stored order's status is the one thing about it that changes after
 * publication: an order is ingested as active, and months later another
 * order revokes it and "Revoked by: ..." appears on its own disposition
 * notes. syncDocument used to return "unchanged" the moment the
 * document_number matched, so that line was never read.
 */
function doc(overrides: Partial<FederalRegisterDocument> = {}): FederalRegisterDocument {
  return {
    document_number: "2026-17843",
    title: "Some Order",
    subtype: "Executive Order",
    executive_order_number: 14421,
    signing_date: "2026-01-05",
    publication_date: "2026-01-07",
    citation: "91 FR 1",
    html_url: "https://www.federalregister.gov/documents/x",
    raw_text_url: "https://www.federalregister.gov/raw/x",
    disposition_notes: null,
    executive_order_notes: null,
    correction_of: null,
    corrections: [],
    ...overrides,
  } as FederalRegisterDocument;
}

function storedRow(status: string, manuallyEdited: string[] = []) {
  return {
    rows: [
      {
        id: "row-1",
        document_number: "2026-17843",
        status,
        manually_edited_fields: manuallyEdited,
        applied_correction_document_numbers: [],
      },
    ],
  };
}

describe("status refresh on an already-stored document", () => {
  it("revokes an order once the Federal Register says it was revoked", async () => {
    const supabase = createFakeSupabase(storedRow("active"));

    const outcome = await syncDocument(
      supabase,
      doc({ disposition_notes: "Revoked by: EO 14244, March 21, 2025" }),
      async () => "raw text",
    );

    expect(outcome.action).toBe("updated");
    expect(outcome.detail).toBe("status active -> revoked");
    expect(supabase.rows[0].status).toBe("revoked");
  });

  it("amends an order once it has been amended by another", async () => {
    const supabase = createFakeSupabase(storedRow("active"));

    const outcome = await syncDocument(
      supabase,
      doc({ disposition_notes: "Amended by: EO 14244, March 21, 2025" }),
      async () => "raw text",
    );

    expect(outcome.action).toBe("updated");
    expect(supabase.rows[0].status).toBe("amended");
  });

  it("does NOT revoke an order whose notes say what it revoked", async () => {
    // The whole bug, in one test: active voice must not change this order.
    const supabase = createFakeSupabase(storedRow("active"));

    const outcome = await syncDocument(
      supabase,
      doc({ disposition_notes: "Revokes: EO 13993, January 20, 2021" }),
      async () => "raw text",
    );

    expect(outcome.action).toBe("unchanged");
    expect(supabase.rows[0].status).toBe("active");
  });

  it("reads executive_order_notes when disposition_notes is absent", async () => {
    const supabase = createFakeSupabase(storedRow("active"));

    const outcome = await syncDocument(
      supabase,
      doc({ disposition_notes: null, executive_order_notes: "Revoked by: EO 14244" }),
      async () => "raw text",
    );

    expect(outcome.action).toBe("updated");
    expect(supabase.rows[0].status).toBe("revoked");
  });

  it("leaves a hand-set status alone and flags the disagreement instead", async () => {
    const supabase = createFakeSupabase(storedRow("active", ["status"]));

    const outcome = await syncDocument(
      supabase,
      doc({ disposition_notes: "Revoked by: EO 14244" }),
      async () => "raw text",
    );

    expect(outcome.action).toBe("flagged");
    expect(outcome.detail).toContain("manually edited");
    expect(supabase.rows[0].status).toBe("active");
  });

  it("still never downloads the text, even when the status does change", async () => {
    // The 2026-09-19 outage was 47 pointless raw-text downloads, all
    // refused with a 429. Re-reading a disposition uses only fields the
    // document already carries, and must not reintroduce that fetch.
    const supabase = createFakeSupabase(storedRow("active"));
    const fetchRawFullText = vi.fn(async () => "raw text");

    const outcome = await syncDocument(
      supabase,
      doc({ disposition_notes: "Revoked by: EO 14244" }),
      fetchRawFullText,
    );

    expect(outcome.action).toBe("updated");
    expect(fetchRawFullText).not.toHaveBeenCalled();
  });

  it("does not rewrite anything but the status", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          document_number: "2026-17843",
          status: "active",
          title: "A title an attorney edited",
          ai_summary: "A summary an attorney wrote",
          manually_edited_fields: [],
          applied_correction_document_numbers: [],
        },
      ],
    });

    await syncDocument(supabase, doc({ disposition_notes: "Revoked by: EO 14244" }), async () => "raw");

    expect(supabase.rows[0].title).toBe("A title an attorney edited");
    expect(supabase.rows[0].ai_summary).toBe("A summary an attorney wrote");
    expect(supabase.rows[0].status).toBe("revoked");
  });
});
