import type { DocketSearchResult, SearchDockets } from "./client";
import { docketUrl } from "./client";
import { expandAgencyAbbreviations } from "./agency-abbreviations";
import { resolveCourtId } from "./court-codes";
import { matchChallengeToDocket } from "./match-case";
import { normalizeCaseName } from "./normalize-case-name";
import type { CourtListenerDocket, MatchOutcome } from "./types";

/**
 * Turns the legal_challenges the firm already recorded into a plan: which
 * ones can be linked to a real docket, which need a human to choose, and
 * which can't be found. Builds the plan only — writing it back to the
 * database is the caller's job, so this can be run and reviewed without
 * touching live data.
 */

/** One entry as it is stored in the legal_challenges jsonb column. */
export interface StoredChallenge {
  caseName?: string;
  court?: string;
  status?: string;
  summary?: string;
  docketUrl?: string;
  [key: string]: unknown;
}

export interface ChallengeRow {
  id: string;
  eoNumber: string | null;
  title: string;
  dateSigned: string | null;
  legalChallenges: StoredChallenge[];
}

/** A docket reduced to the fields worth recording or showing in review. */
export interface DocketLink {
  docketId: number;
  caseName: string;
  court: string;
  docketNumber: string;
  dateFiled: string | null;
  dateTerminated: string | null;
  url: string;
}

export interface ChallengeLinkDecision {
  eoId: string;
  eoNumber: string | null;
  eoTitle: string;
  caseName: string;
  court: string;
  outcome: MatchOutcome;
  reason: string;
  /** The docket to link. Set only for a confident match. */
  link: DocketLink | null;
  /** What a human picks from when the outcome is "ambiguous". */
  candidates: DocketLink[];
  /**
   * Filled in BY HAND in the review file: the docketId from `candidates` that
   * is actually the right case. A later --apply run reads this, which is how
   * an ambiguous entry gets resolved without the matcher ever guessing.
   */
  chosenDocketId: number | null;
}

function toLink(docket: CourtListenerDocket): DocketLink {
  return {
    docketId: docket.docket_id,
    caseName: docket.caseName,
    court: docket.court_citation_string,
    docketNumber: docket.docketNumber,
    dateFiled: docket.dateFiled,
    dateTerminated: docket.dateTerminated,
    url: docketUrl(docket),
  };
}

/** Cache key: the same case name in the same court only needs searching once. */
function searchKey(caseName: string, court: string): string {
  return `${normalizeCaseName(caseName)}::${resolveCourtId(court) ?? "nocourt"}`;
}

export interface LinkPlanOptions {
  rows: ChallengeRow[];
  searchDockets: SearchDockets;
  /** Called before each *uncached* search, so the caller can pace requests and show progress. */
  onSearch?: (caseName: string, court: string) => Promise<void> | void;
  /**
   * Called as each decision is reached. Lets the caller keep partial results
   * when a run dies part-way — a full pass takes minutes and a rate-limit
   * refusal late in it would otherwise discard everything.
   */
  onDecision?: (decision: ChallengeLinkDecision) => void;
}

/**
 * Runs every recorded challenge through the gate. One search per distinct
 * case-name-and-court pair: the live data has 252 entries but only ~150
 * distinct case names, because one suit often challenges several orders.
 */
export async function buildLinkPlan({ rows, searchDockets, onSearch, onDecision }: LinkPlanOptions): Promise<ChallengeLinkDecision[]> {
  const decisions: ChallengeLinkDecision[] = [];
  const cache = new Map<string, DocketSearchResult>();

  for (const row of rows) {
    for (const challenge of row.legalChallenges) {
      const caseName = (challenge.caseName ?? "").trim();
      const court = (challenge.court ?? "").trim();

      const base = {
        eoId: row.id,
        eoNumber: row.eoNumber,
        eoTitle: row.title,
        caseName,
        court,
        chosenDocketId: null,
      };

      const record = (decision: ChallengeLinkDecision) => {
        decisions.push(decision);
        onDecision?.(decision);
      };

      if (!caseName) {
        record({
          ...base,
          outcome: "not_found",
          reason: "The recorded entry has no case name to match on.",
          link: null,
          candidates: [],
        });
        continue;
      }

      const key = searchKey(caseName, court);
      let results = cache.get(key);
      if (!results) {
        await onSearch?.(caseName, court);
        results = await searchDockets({ caseName, courtId: resolveCourtId(court) });
        cache.set(key, results);
      }

      const match = matchChallengeToDocket({ caseName, court, orderDateSigned: row.dateSigned }, results);

      // Nothing under the name as the firm wrote it. Before giving up, try
      // the agency acronyms spelled out — the firm records "FBI Agents
      // Association et al v. DOJ" where the docket reads "FEDERAL BUREAU OF
      // INVESTIGATION AGENTS ASSOCIATION v. DEPARTMENT OF JUSTICE".
      if (match.outcome === "not_found") {
        const expanded = await findByExpandedName({
          caseName,
          court,
          orderDateSigned: row.dateSigned,
          searchDockets,
          onSearch,
          cache,
        });
        if (expanded) {
          record({ ...base, ...expanded });
          continue;
        }
      }

      record({
        ...base,
        outcome: match.outcome,
        reason: match.reason,
        link: match.docket ? toLink(match.docket) : null,
        candidates: match.candidates.map(toLink),
      });
    }
  }

  return decisions;
}

/**
 * How many expanded spellings to try for one case name. Each costs another
 * search against a free, rate-limited API, and the expander orders its
 * candidates most-likely-first, so trying every one buys little.
 */
const MAX_EXPANSIONS_TRIED = 3;

/**
 * Searches for a case under its agency acronyms spelled out, and reports
 * what it finds as ambiguous — never as a confident link.
 *
 * The downgrade is the point. Expanding "DOJ" to "Department of Justice" is
 * an inference about what the firm meant, and a match found only by way of
 * that inference has one more assumption in it than a match on the name as
 * written. A human confirms those; the matcher does not.
 */
async function findByExpandedName(params: {
  caseName: string;
  court: string;
  orderDateSigned: string | null;
  searchDockets: SearchDockets;
  onSearch?: (caseName: string, court: string) => Promise<void> | void;
  cache: Map<string, DocketSearchResult>;
}): Promise<Pick<ChallengeLinkDecision, "outcome" | "reason" | "link" | "candidates"> | null> {
  const { caseName, court, orderDateSigned, searchDockets, onSearch, cache } = params;

  for (const expandedName of expandAgencyAbbreviations(caseName).slice(0, MAX_EXPANSIONS_TRIED)) {
    const key = searchKey(expandedName, court);
    let results = cache.get(key);
    if (!results) {
      await onSearch?.(expandedName, court);
      results = await searchDockets({ caseName: expandedName, courtId: resolveCourtId(court) });
      cache.set(key, results);
    }

    // Matched against the expanded name, since that is what was searched.
    const match = matchChallengeToDocket({ caseName: expandedName, court, orderDateSigned }, results);
    if (match.outcome === "not_found") continue;

    const found = match.docket ? [match.docket, ...match.candidates.filter((c) => c !== match.docket)] : match.candidates;
    return {
      outcome: "ambiguous",
      reason: `Not found as written, but "${expandedName}" matches — the agency name was abbreviated. Confirm this is the same case.`,
      link: null,
      candidates: found.map(toLink),
    };
  }

  return null;
}

export interface LinkPlanSummary {
  total: number;
  confident: number;
  ambiguous: number;
  notFound: number;
  /** Distinct case names that matched — the honest "how many real cases did we find" number. */
  distinctCasesLinked: number;
}

export function summarizeLinkPlan(decisions: ChallengeLinkDecision[]): LinkPlanSummary {
  const linked = new Set<number>();
  for (const d of decisions) {
    if (d.outcome === "confident" && d.link) linked.add(d.link.docketId);
  }
  return {
    total: decisions.length,
    confident: decisions.filter((d) => d.outcome === "confident").length,
    ambiguous: decisions.filter((d) => d.outcome === "ambiguous").length,
    notFound: decisions.filter((d) => d.outcome === "not_found").length,
    distinctCasesLinked: linked.size,
  };
}

/**
 * Merges a decision's docket into the stored challenge entry, leaving every
 * other field exactly as the firm wrote it. Never overwrites a docketUrl
 * that is already there — a link a human put in wins over a matched one.
 */
export function applyLinkToChallenge(challenge: StoredChallenge, link: DocketLink): StoredChallenge {
  if (challenge.docketUrl) return challenge;
  return {
    ...challenge,
    docketUrl: link.url,
    docketNumber: link.docketNumber,
    dateFiled: link.dateFiled,
    // Provenance: where this link came from and when, so a later reader can
    // tell a matched link from a hand-entered one (see CLAUDE.md's
    // audit-trail item). Costs nothing — legal_challenges is jsonb.
    linkSource: "courtlistener",
    linkedAt: new Date().toISOString().slice(0, 10),
  };
}
