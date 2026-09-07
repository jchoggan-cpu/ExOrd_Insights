// Shape of a Federal Register API document, trimmed to the fields this
// project actually uses (see documents/{document_number}.json). Covers
// Executive Orders, Proclamations, and Memoranda (subtype distinguishes
// them) — https://www.federalregister.gov/developers/documentation/api/v1

export type PresidentialDocumentType = "Executive Order" | "Proclamation" | "Memorandum";

export interface FederalRegisterDocument {
  document_number: string;
  title: string;
  subtype: PresidentialDocumentType;
  /** Only populated when subtype is "Executive Order"; null for Proclamations/Memoranda. */
  executive_order_number: string | null;
  signing_date: string | null; // ISO date
  publication_date: string; // ISO date
  citation: string | null;
  html_url: string;
  raw_text_url: string;
  /** Same content as disposition_notes; both observed populated together. */
  executive_order_notes: string | null;
  disposition_notes: string | null;
  /** URL of the original document this one corrects, e.g. ".../documents/2026-03829". Null unless this document is itself a correction. */
  correction_of: string | null;
  /** URLs of documents that correct this one. Empty unless a later correction was issued. */
  corrections: string[];
}

/** List/search endpoint envelope for documents.json. */
export interface FederalRegisterListResponse {
  count: number;
  total_pages: number;
  next_page_url: string | null;
  results: FederalRegisterDocument[];
}
