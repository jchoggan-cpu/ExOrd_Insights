import { describe, expect, it, vi } from "vitest";
import { fetchAllDocuments, fetchDocumentDetail, fetchRawText, MINIMAL_FIELDS } from "@/lib/federal-register/client";
import type { RetryingFetch } from "@/lib/federal-register/fetch-with-retry";
import type { FederalRegisterDocument } from "@/lib/federal-register/types";

function doc(documentNumber: string): FederalRegisterDocument {
  return { document_number: documentNumber } as FederalRegisterDocument;
}

function listPage(results: FederalRegisterDocument[], nextPageUrl: string | null): Response {
  return new Response(
    JSON.stringify({ count: results.length, total_pages: 1, next_page_url: nextPageUrl, results }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
}

describe("fetchAllDocuments", () => {
  it("asks only for the three presidential document types this project tracks", async () => {
    const fetchUrl = vi.fn<RetryingFetch>(async () => listPage([], null));

    await fetchAllDocuments({ publicationDateGte: "2025-01-20" }, fetchUrl);

    const url = new URL(fetchUrl.mock.calls[0][0]);
    expect(url.searchParams.getAll("conditions[presidential_document_type][]")).toEqual([
      "executive_order",
      "proclamation",
      "memorandum",
    ]);
    expect(url.searchParams.get("conditions[publication_date][gte]")).toBe("2025-01-20");
  });

  it("requests only the cheap fields when asked for the minimal set", async () => {
    const fetchUrl = vi.fn<RetryingFetch>(async () => listPage([], null));

    await fetchAllDocuments({ fields: MINIMAL_FIELDS }, fetchUrl);

    expect(new URL(fetchUrl.mock.calls[0][0]).searchParams.getAll("fields[]")).toEqual([
      "document_number",
      "correction_of",
    ]);
  });

  it("follows the API's pagination until there is no next page", async () => {
    const fetchUrl = vi
      .fn<RetryingFetch>()
      .mockResolvedValueOnce(listPage([doc("2026-00001")], "https://example.test/page-2"))
      .mockResolvedValueOnce(listPage([doc("2026-00002")], null));

    const documents = await fetchAllDocuments({}, fetchUrl);

    expect(documents.map((d) => d.document_number)).toEqual(["2026-00001", "2026-00002"]);
    expect(fetchUrl.mock.calls[1][0]).toBe("https://example.test/page-2");
  });

  // A refused list request and an empty window mean entirely different
  // things; returning [] for the first would report a healthy run that
  // silently ingested nothing.
  it("throws rather than returning an empty list when the API refuses", async () => {
    const fetchUrl: RetryingFetch = async () => new Response("", { status: 429 });

    await expect(fetchAllDocuments({}, fetchUrl)).rejects.toThrow(/failed \(429\)/);
  });
});

describe("fetchDocumentDetail", () => {
  it("fetches one document by its number", async () => {
    const fetchUrl = vi.fn<RetryingFetch>(async () => new Response(JSON.stringify(doc("2026-17843")), { status: 200 }));

    const result = await fetchDocumentDetail("2026-17843", fetchUrl);

    expect(fetchUrl.mock.calls[0][0]).toBe("https://www.federalregister.gov/api/v1/documents/2026-17843.json");
    expect(result.document_number).toBe("2026-17843");
  });

  it("throws, naming the document, when the API refuses", async () => {
    const fetchUrl: RetryingFetch = async () => new Response("", { status: 503 });

    await expect(fetchDocumentDetail("2026-17843", fetchUrl)).rejects.toThrow(/2026-17843 \(503\)/);
  });
});

describe("fetchRawText", () => {
  it("returns the body verbatim, leaving cleanup to clean-text.ts", async () => {
    const fetchUrl: RetryingFetch = async () => new Response("  Executive Order 14421  \n", { status: 200 });

    expect(await fetchRawText("https://example.test/doc.txt", fetchUrl)).toBe("  Executive Order 14421  \n");
  });

  it("throws with the status and URL when the text is refused", async () => {
    const fetchUrl: RetryingFetch = async () => new Response("", { status: 429 });

    await expect(fetchRawText("https://example.test/doc.txt", fetchUrl)).rejects.toThrow(
      "Failed to fetch raw text (429): https://example.test/doc.txt",
    );
  });
});
