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
  eoNumber: string;
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
