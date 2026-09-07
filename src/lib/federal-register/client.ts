import type { FederalRegisterDocument, FederalRegisterListResponse } from "@/lib/federal-register/types";

const LIST_URL = "https://www.federalregister.gov/api/v1/documents.json";
const DETAIL_BASE_URL = "https://www.federalregister.gov/api/v1/documents";

// The three presidential_document_type values this project tracks — matches
// what the legacy spreadsheet covered (see README "Where the data comes
// from"). Confirmed against the live API; "proclamation" and "memorandum"
// are the API's own filter values, not guesses.
const DOCUMENT_TYPES = ["executive_order", "proclamation", "memorandum"] as const;

/** Every field syncDocument needs to ingest or correct a document. */
export const FULL_FIELDS = [
  "document_number",
  "title",
  "subtype",
  "executive_order_number",
  "signing_date",
  "publication_date",
  "citation",
  "html_url",
  "raw_text_url",
  "executive_order_notes",
  "disposition_notes",
  "correction_of",
  "corrections",
] as const;

/** Cheap subset for reconciliation's existence check — no full text pulled. */
export const MINIMAL_FIELDS = ["document_number", "correction_of"] as const;

function buildQuery(params: {
  publicationDateGte?: string;
  publicationDateLte?: string;
  perPage: number;
  fields: readonly string[];
}): string {
  const search = new URLSearchParams();
  search.append("conditions[type][]", "PRESDOCU");
  for (const type of DOCUMENT_TYPES) {
    search.append("conditions[presidential_document_type][]", type);
  }
  if (params.publicationDateGte) {
    search.append("conditions[publication_date][gte]", params.publicationDateGte);
  }
  if (params.publicationDateLte) {
    search.append("conditions[publication_date][lte]", params.publicationDateLte);
  }
  for (const field of params.fields) {
    search.append("fields[]", field);
  }
  search.append("order", "oldest");
  search.append("per_page", String(params.perPage));
  return `${LIST_URL}?${search.toString()}`;
}

/**
 * Fetches every Executive Order / Proclamation / Memorandum published in
 * the given date range, following the API's own cursor-based pagination.
 * No API key required (see README "Fair-use terms"). Pass MINIMAL_FIELDS for
 * a cheap existence-only check (reconciliation); defaults to FULL_FIELDS.
 */
export async function fetchAllDocuments(params: {
  publicationDateGte?: string;
  publicationDateLte?: string;
  fields?: readonly string[];
}): Promise<FederalRegisterDocument[]> {
  const documents: FederalRegisterDocument[] = [];
  let url: string | null = buildQuery({ ...params, perPage: 1000, fields: params.fields ?? FULL_FIELDS });

  while (url) {
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Federal Register API request failed (${response.status}): ${url}`);
    }
    const body: FederalRegisterListResponse = await response.json();
    documents.push(...body.results);
    url = body.next_page_url;
  }

  return documents;
}

/** Fetches one document's full detail by document_number — used by reconciliation to fetch only the gaps it finds. */
export async function fetchDocumentDetail(documentNumber: string): Promise<FederalRegisterDocument> {
  const response = await fetch(`${DETAIL_BASE_URL}/${documentNumber}.json`);
  if (!response.ok) {
    throw new Error(`Failed to fetch document detail for ${documentNumber} (${response.status})`);
  }
  return response.json();
}

/** Fetches and returns the raw (uncleaned) full text for one document. */
export async function fetchRawText(rawTextUrl: string): Promise<string> {
  const response = await fetch(rawTextUrl);
  if (!response.ok) {
    throw new Error(`Failed to fetch raw text (${response.status}): ${rawTextUrl}`);
  }
  return response.text();
}
