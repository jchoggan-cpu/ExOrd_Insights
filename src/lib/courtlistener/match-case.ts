import type { CourtListenerDocket, DocketMatch } from "./types";
import { resolveCourtId } from "./court-codes";
import { normalizeCaseName, partiesLookAlike, splitParties } from "./normalize-case-name";

/**
 * Decides whether a legal_challenges entry the firm recorded corresponds to
 * a real docket CourtListener returned — the verification gate that runs
 * before anything is written back.
 *
 * The rule this file exists to enforce: a docket link is only attached when
 * the case name matches exactly, in the court the firm named, within a
 * plausible date window, and no other docket also fits. Everything short of
 * that is handed to a human instead of guessed at. For a law firm a wrong
 * docket link is worse than an empty cell, so "probably this one" is not an
 * outcome this function can return.
 */

// Criminal dockets ("1:25-cr-00464") are prosecutions that may cite an
// executive order; they are never challenges to one. Observed polluting a
// naive EO-number search, which is why they're excluded by rule.
const CRIMINAL_DOCKET = /-cr-/i;

/**
 * How long before the order was signed a matching case may have been filed.
 * A challenge normally follows its order, but an existing suit is sometimes
 * amended to add a new order, so a short lead-in is allowed rather than
 * discarding those outright.
 */
const FILED_BEFORE_ORDER_GRACE_DAYS = 30;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function daysBetween(earlier: string, later: string): number | null {
  const a = Date.parse(earlier);
  const b = Date.parse(later);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return (b - a) / MS_PER_DAY;
}

/** True when a docket was filed late enough to be a challenge to an order signed on `orderDate`. */
function isPlausiblyAfterOrder(docket: CourtListenerDocket, orderDate: string | null): boolean {
  // With no filing date or no order date there's nothing to test against, so
  // the docket is kept — the name and court checks still have to pass, and
  // an unfiltered candidate can at worst land in the ambiguous pile.
  if (!docket.dateFiled || !orderDate) return true;
  const gap = daysBetween(orderDate, docket.dateFiled);
  if (gap === null) return true;
  return gap >= -FILED_BEFORE_ORDER_GRACE_DAYS;
}

export interface ChallengeToMatch {
  caseName: string;
  court?: string | null;
  /** date_signed of the executive order this challenge is recorded against. */
  orderDateSigned?: string | null;
}

/**
 * Applies the gate to one recorded challenge against the dockets a search
 * returned. Pure — it does no fetching, so its behaviour is fully testable
 * without a network call.
 */
export function matchChallengeToDocket(
  challenge: ChallengeToMatch,
  search: { dockets: CourtListenerDocket[]; truncated: boolean },
): DocketMatch {
  const candidates = search.dockets;
  const recordedName = normalizeCaseName(challenge.caseName);
  if (!recordedName) {
    return { outcome: "not_found", candidates: [], reason: "The recorded entry has no case name to match on." };
  }

  const courtId = resolveCourtId(challenge.court);

  const viable = candidates
    .filter((d) => !CRIMINAL_DOCKET.test(d.docketNumber))
    .filter((d) => isPlausiblyAfterOrder(d, challenge.orderDateSigned ?? null));

  const inCourt = courtId ? viable.filter((d) => d.court_id === courtId) : viable;

  const exact = inCourt.filter((d) => normalizeCaseName(d.caseName) === recordedName);
  const alike = inCourt.filter((d) => !exact.includes(d) && partiesAlike(challenge.caseName, d.caseName));
  const nearby = [...exact, ...alike];

  if (!courtId) {
    // Without a court there's no way to tell two identically-named cases
    // apart (there are several "Doe v. Noem"), so this can never be
    // confident however clean the name match looks.
    const courtProblem = challenge.court
      ? `court "${challenge.court}" isn't one CourtListener recognizes`
      : "no court was recorded";
    return nearby.length > 0
      ? {
          outcome: "ambiguous",
          candidates: nearby,
          reason: `Found ${nearby.length} possible docket(s), but ${courtProblem}, so the match can't be confirmed.`,
        }
      : {
          outcome: "not_found",
          candidates: [],
          reason: `No docket matches this case name, and ${courtProblem}.`,
        };
  }

  if (exact.length === 1) {
    // "Sole result" is only true if we actually saw the whole result set.
    if (search.truncated) {
      return {
        outcome: "ambiguous",
        candidates: nearby,
        reason: "One exact match on the first page of results, but there are more pages — another docket could share this name.",
      };
    }
    // A docket with no filing date passed no date check at all, so the third
    // confirmation criterion is missing and this can't be called confident.
    if (challenge.orderDateSigned && !exact[0].dateFiled) {
      return {
        outcome: "ambiguous",
        candidates: nearby,
        reason: "Exact case-name match, but the docket has no filing date to check against the order's date.",
      };
    }
    return {
      outcome: "confident",
      docket: exact[0],
      candidates: nearby,
      reason: `Exact case-name match, sole result in ${exact[0].court_citation_string}`,
    };
  }

  if (exact.length > 1) {
    return {
      outcome: "ambiguous",
      candidates: nearby,
      reason: `${exact.length} different dockets in that court share this case name — a human has to pick.`,
    };
  }

  if (alike.length > 0) {
    return {
      outcome: "ambiguous",
      candidates: nearby,
      reason: `No exact name match; ${alike.length} docket(s) in that court have similar party names.`,
    };
  }

  return {
    outcome: "not_found",
    candidates: [],
    reason: `No docket in ${challenge.court} matches this case name — it may have been renamed, or may not be in RECAP.`,
  };
}

/** Both sides of the caption look like the same parties — see partiesLookAlike. */
function partiesAlike(recorded: string, candidate: string): boolean {
  const a = splitParties(recorded);
  const b = splitParties(candidate);
  if (!a || !b) return false;
  return partiesLookAlike(a.plaintiff, b.plaintiff) && partiesLookAlike(a.defendant, b.defendant);
}
