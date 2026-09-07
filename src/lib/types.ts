// Shared types for the EO tracker. These mirror supabase/migrations/0001_init.sql —
// keep the two in sync when the schema changes.

export type EoStatus = "active" | "amended" | "revoked";

export type ContentType =
  | "client_alert"
  | "blog_post"
  | "talking_points"
  | "social_post";

export const CONTENT_TYPE_LABELS: Record<ContentType, string> = {
  client_alert: "Client Alert / Memo",
  blog_post: "Blog Post",
  talking_points: "Internal Talking Points",
  social_post: "Social Media Post",
};

export interface KeyDate {
  label: string;
  date: string; // ISO date
}

export interface LegalChallenge {
  caseName: string;
  court: string;
  status: string; // e.g. "Pending", "Injunction granted", "Dismissed"
  docketUrl?: string;
  summary: string;
}

export interface NewsMention {
  title: string;
  source: string;
  url: string;
  date: string; // ISO date
  snippet: string;
}

export interface ExecutiveOrder {
  id: string;
  /** Present only for true Executive Orders (e.g. "EO 14351"); null for Proclamations, Memoranda, etc. */
  eoNumber?: string;
  /** e.g. "Executive Order", "Proclamation", "Memorandum" — the source spreadsheet's "Type/Number" field split apart. */
  actionType?: string;
  title: string;
  federalRegisterUrl?: string;
  dateSigned: string; // ISO date
  datePublished?: string; // ISO date
  status: EoStatus;
  agenciesImpacted: string[];
  keyDates: KeyDate[];

  // Tagging — see src/config/practice-areas.json and industries.json
  subjectArea: string[];
  practiceAreas: string[];
  industries: string[];

  // Narrative / analysis fields
  aiSummary?: string;
  deliverable?: string;
  timelineNotes?: string;
  availableAnalysis?: string;
  legalChallenges: LegalChallenge[];
  newsMentions: NewsMention[];

  manuallyEditedFields: string[];

  /**
   * Set at read-time (see flagDuplicateEoNumbers in src/lib/data.ts) when this
   * record's eoNumber is shared with another record — a known data-quality
   * issue inherited from the source spreadsheet, not something to silently
   * trust. Not stored in the database; recomputed on every fetch.
   */
  needsReview?: boolean;
  needsReviewReason?: string;

  // Federal Register ingestion (Phase 2) ------------------------------------
  /** Federal Register's own permanent ID (e.g. "2026-17843") — the ingestion upsert key. Null on legacy rows until reconciled. */
  documentNumber?: string;
  /** document_number of every Federal Register correction merged into this row (see sync.ts) — lets reconciliation account for corrections. Empty/absent except on rows a correction has actually been applied to. */
  appliedCorrectionDocumentNumbers?: string[];
  citation?: string;
  /** Cleaned raw_text_url content — the ground truth AI-generated quotes are checked against. */
  fullText?: string;
  /** Raw disposition_notes/executive_order_notes, verbatim, regardless of whether parseDispositionNotes recognized the format. */
  sourceNotes?: string;
  /**
   * Stored, ingestion-set flag — distinct from the computed needsReview
   * above. Set when a Federal Register correction would overwrite a
   * manuallyEditedFields entry, or when backfill can't confidently match a
   * legacy row to a Federal Register document. ingestionFlagReason explains
   * why.
   */
  ingestionFlagged?: boolean;
  ingestionFlagReason?: string;
  /** Last time ingestion (not a manual edit) touched this row. */
  federalRegisterSyncedAt?: string;

  createdAt: string;
  updatedAt: string;
}

export interface ContentDraft {
  id: string;
  eoIds: string[];
  contentType: ContentType;
  title?: string;
  draftText: string;
  createdBy?: string;
  createdAt: string;
}

export type UserRole = "admin" | "general";

export interface Profile {
  id: string;
  email: string;
  role: UserRole;
  receivesDigest: boolean;
}

/** A pre-2025 executive order the current administration rescinded (from the "Rescinded Exec Actions" sheet). */
export interface RescindedPriorOrder {
  id: string;
  orderNumber?: string;
  dateSigned?: string; // ISO date
  title: string;
  administration: string; // e.g. "Carter", "Clinton", "Biden"
  createdAt: string;
}

/** A non-EO agency-level action (memo, guidance, rule) tracked alongside the EOs (from the "Select Agency Actions" sheet). */
export interface AgencyAction {
  id: string;
  title: string;
  issuingAgency: string;
  keyDate?: string; // ISO date
  otherAgenciesImpacted: string[];
  legalChallenges: LegalChallenge[];
  availableAnalysis?: string;
  relatedEoNumber?: string;
  createdAt: string;
}
