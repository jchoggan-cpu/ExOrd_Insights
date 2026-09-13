import COURT_IDS from "./court-ids.json";

/**
 * Turns a court as the firm writes it into CourtListener's court id
 * ("D.D.C." -> "dcd"), so a docket search can be constrained to the right
 * court. Returns null when the court can't be identified — the caller must
 * treat that as "can't confirm", never as "no court filter".
 *
 * The firm's spreadsheet records courts as free text and spells the same
 * court several ways: D.D.C. / D.D.C / D.DC, D. Mass. / D.Mass / Mass.
 * Normalizing away punctuation and case collapses most of that; the rest
 * are listed as explicit aliases below.
 */

// Strips a trailing year some entries carry ("N.D. Cal. 2025").
const TRAILING_YEAR = /\s*\b(19|20)\d{2}\b\s*$/;

/**
 * Reduces a court string to a comparison key: lowercase, no punctuation, no
 * spaces. "D. Md." / "D.Md" / "D. Md" all become "dmd". Exported because
 * scripts/generate-court-ids.ts builds the lookup's keys with this exact
 * function — the two must never drift apart.
 */
export function normalizeCourtKey(court: string): string {
  return court.replace(TRAILING_YEAR, "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

/**
 * Spellings in the firm's data that don't normalize to any CourtListener
 * citation_string, mapped to the key of the one they mean. Each was observed
 * in the live legal_challenges data, not invented defensively — add to this
 * only when a real row fails to resolve.
 */
const ALIASES: Record<string, string> = {
  wdwa: "wdwash", // "W.D.Wa." -> W.D. Wash.
  mass: "dmass", // bare state name
  massachusetts: "dmass",
  dcdmassachusetts: "dmass", // "D.C.D. Massachusetts" — garbled in the source
  dcolorado: "dcolo",
  ndillinois: "ndill",
  ndtexas: "ndtex",
  ctfedcl: "fedcl", // "Ct. Fed. Cl." -> Fed. Cl.
  dmd: "dmaryland", // CourtListener cites Maryland unabbreviated ("D. Maryland")
};

const COURT_ID_BY_KEY = COURT_IDS as Record<string, string>;

/** CourtListener court id for a firm-written court string, or null if unrecognized. */
export function resolveCourtId(court: string | null | undefined): string | null {
  if (!court) return null;
  const key = normalizeCourtKey(court);
  if (!key) return null;
  return COURT_ID_BY_KEY[ALIASES[key] ?? key] ?? null;
}
