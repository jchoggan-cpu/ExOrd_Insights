import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { runReconcileJob } from "@/lib/federal-register/reconcile-job";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";
import { createFakeSupabase } from "@/lib/federal-register/test-support/fake-supabase";

const FIXTURE_DIR = join(__dirname, "fixtures");

function loadDoc(name: string): FederalRegisterDocument {
  return JSON.parse(readFileSync(join(FIXTURE_DIR, name), "utf-8"));
}

function loadRawText(name: string): string {
  return readFileSync(join(FIXTURE_DIR, name), "utf-8");
}

describe("runReconcileJob", () => {
  it("happy path: finds a gap, fetches its full detail, ingests it, and records success", async () => {
    const supabase = createFakeSupabase({ rows: [] });
    const fullDoc = loadDoc("eo-14421-detail.json");
    const rawText = loadRawText("eo-14421-raw-text.txt");

    const result = await runReconcileJob(supabase, {
      fetchAllDocuments: async () => [{ document_number: fullDoc.document_number, correction_of: null } as FederalRegisterDocument],
      fetchDocumentDetail: async (documentNumber: string) => {
        expect(documentNumber).toBe(fullDoc.document_number);
        return fullDoc;
      },
      fetchRawText: async () => rawText,
    });

    expect(result.status).toBe("success");
    expect(result.gapsFound).toBe(1);
    expect(result.newCount).toBe(1);
    expect(supabase.rows).toHaveLength(1);
    expect(supabase.rows[0].document_number).toBe(fullDoc.document_number);

    expect(supabase.ingestionRuns[0]).toMatchObject({
      id: result.runId,
      run_type: "federal_register_reconciliation",
      status: "success",
      new_count: 1,
    });
  });

  it("does not treat an already-accounted-for document (or an applied correction) as a gap", async () => {
    const supabase = createFakeSupabase({
      rows: [
        {
          id: "row-1",
          document_number: "2026-17843",
          applied_correction_document_numbers: ["R1-2026-17843"],
        },
      ],
    });

    const result = await runReconcileJob(supabase, {
      fetchAllDocuments: async () =>
        [
          { document_number: "2026-17843", correction_of: null },
          { document_number: "R1-2026-17843", correction_of: "https://www.federalregister.gov/api/v1/documents/2026-17843" },
        ] as FederalRegisterDocument[],
      fetchDocumentDetail: async () => {
        throw new Error("should never fetch detail for a document already accounted for");
      },
      fetchRawText: async () => {
        throw new Error("should never fetch raw text for a document already accounted for");
      },
    });

    expect(result.status).toBe("success");
    expect(result.gapsFound).toBe(0);
    expect(result.newCount).toBe(0);
  });

  it("isolates a per-gap failure: one bad gap doesn't abort the run, and is reported in errors/partial status", async () => {
    const supabase = createFakeSupabase({ rows: [] });
    const goodDoc = loadDoc("eo-14421-detail.json");
    const goodRawText = loadRawText("eo-14421-raw-text.txt");

    const result = await runReconcileJob(supabase, {
      fetchAllDocuments: async () =>
        [
          { document_number: "bad-doc", correction_of: null },
          { document_number: goodDoc.document_number, correction_of: null },
        ] as FederalRegisterDocument[],
      fetchDocumentDetail: async (documentNumber: string) => {
        if (documentNumber === "bad-doc") throw new Error("detail fetch failed");
        return goodDoc;
      },
      fetchRawText: async () => goodRawText,
    });

    expect(result.status).toBe("partial");
    expect(result.gapsFound).toBe(2);
    expect(result.newCount).toBe(1); // only the good gap counted
    expect(result.errorMessage).toContain("bad-doc");
    expect(result.errorMessage).toContain("detail fetch failed");
    expect(supabase.rows).toHaveLength(1);
    expect(supabase.rows[0].document_number).toBe(goodDoc.document_number);
  });

  it("reports failure without attempting any gap when the Federal Register list request itself fails", async () => {
    const supabase = createFakeSupabase({ rows: [] });

    const result = await runReconcileJob(supabase, {
      fetchAllDocuments: async () => {
        throw new Error("Federal Register API request failed (503)");
      },
      fetchDocumentDetail: async () => {
        throw new Error("should never be called");
      },
      fetchRawText: async () => {
        throw new Error("should never be called");
      },
    });

    expect(result.status).toBe("failure");
    expect(result.gapsFound).toBe(0);
    expect(result.newCount).toBe(0);
    expect(result.errorMessage).toContain("Federal Register API request failed");
    expect(supabase.rows).toHaveLength(0);
    expect(supabase.ingestionRuns[0]).toMatchObject({ status: "failure" });
  });

  it("reports failure without attempting any gap when loading existing document_numbers from Supabase fails", async () => {
    const supabase = createFakeSupabase({ failSelect: { executive_orders: "connection lost" } });

    const result = await runReconcileJob(supabase, {
      fetchAllDocuments: async () => [{ document_number: "2026-17843", correction_of: null } as FederalRegisterDocument],
      fetchDocumentDetail: async () => {
        throw new Error("should never be called");
      },
      fetchRawText: async () => {
        throw new Error("should never be called");
      },
    });

    expect(result.status).toBe("failure");
    expect(result.errorMessage).toContain("connection lost");
    expect(supabase.ingestionRuns[0]).toMatchObject({ status: "failure" });
  });
});
